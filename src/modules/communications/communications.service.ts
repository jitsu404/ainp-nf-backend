import { type ClientSession, Types, trusted } from 'mongoose';
import { hasCapability } from '../../config/constants.js';
import { withTransaction } from '../../config/db.js';
import { AppError } from '../../utils/AppError.js';
import { type RequestContext, isCentreScoped, isNational } from '../../utils/context.js';
import { escapeRegex, skipFor } from '../../utils/validators.js';
import { recordAudit } from '../audit/audit.service.js';
import { activeCentreIds, centresByIds } from '../centres/centres.service.js';
import { getNextSequence } from '../counters/counters.service.js';
import type { ListCommunicationsQuery, SendCommunicationDto } from './communications.dto.js';
import {
  CENTRE_TYPES_TO_PCU,
  type Communication,
  CommunicationModel,
  CommunicationReplyModel,
  PCU_KEY,
  sideKey,
} from './communications.model.js';

const MODULE = 'comm';

type CommunicationDoc = Communication & { _id: Types.ObjectId; id?: string };

/**
 * The caller's side of the correspondence: the PCU (null) for national roles, or the user's centre.
 * Other roles (e.g. an Experiment PI) have no mailbox.
 */
const sideOf = (ctx: RequestContext): string | null => {
  if (isNational(ctx.user)) return null;
  if (isCentreScoped(ctx.user)) {
    if (!ctx.user.centreId) throw AppError.forbidden('NO_CENTRE', 'Your account is not linked to a centre');
    return String(ctx.user.centreId);
  }
  throw AppError.forbidden('NO_MAILBOX', 'Your role has no communication mailbox');
};

const asId = (side: string | null) => (side ? new Types.ObjectId(side) : null);
const sameSide = (a: unknown, b: string | null) => (a ? String(a) : null) === b;

/** AINP-NF/COMM/2026/001: numbered per calendar year, inside the send's transaction. */
const nextRefNo = async (session: ClientSession) => {
  const year = new Date().getFullYear();
  const n = await getNextSequence(`communication:${year}`, session);
  return `AINP-NF/COMM/${year}/${String(n).padStart(3, '0')}`;
};

export const sendCommunication = async (ctx: RequestContext, dto: SendCommunicationDto) => {
  const side = sideOf(ctx);
  let recipients: (string | null)[];
  let toAllCentres = false;
  if (side === null) {
    if (!hasCapability(ctx.user.roleId, 'comm.issue'))
      throw AppError.forbidden('FORBIDDEN', 'You cannot issue communications');
    if (dto.toAllCentres) {
      recipients = await activeCentreIds();
      toAllCentres = true;
    } else {
      const ids = [...new Set(dto.centreIds ?? [])];
      const found = await centresByIds(ids);
      const missing = ids.filter((id) => !found.has(id));
      if (missing.length)
        throw AppError.badRequest('CENTRE_NOT_FOUND', `Centres not found: ${missing.join(', ')}`);
      recipients = ids;
    }
    if (!recipients.length)
      throw AppError.badRequest('NO_RECIPIENTS', 'Choose the centres to send to, or all centres');
  } else {
    // A centre writes to the PCU only: letters and issues.
    if (!hasCapability(ctx.user.roleId, 'comm.ack'))
      throw AppError.forbidden('FORBIDDEN', 'You cannot send communications');
    if (dto.toAllCentres || dto.centreIds?.length)
      throw AppError.badRequest('CENTRE_TO_PCU_ONLY', 'A centre sends communications to the PCU only');
    if (!CENTRE_TYPES_TO_PCU.includes(dto.type))
      throw AppError.badRequest('TYPE_NOT_ALLOWED', `A centre can send: ${CENTRE_TYPES_TO_PCU.join(', ')}`);
    recipients = [null];
  }
  return withTransaction(async (session) => {
    const refNo = await nextRefNo(session);
    const [doc] = await CommunicationModel.create(
      [
        {
          refNo,
          type: dto.type,
          subject: dto.subject,
          body: dto.body,
          fromCentreId: asId(side),
          sentBy: ctx.user.id,
          sentByName: ctx.user.name,
          toAllCentres,
          receipts: recipients.map((r) => ({ centreId: asId(r) })),
          recipientKeys: recipients.map(sideKey),
          replyRequired: dto.replyRequired ?? false,
          dueDate: dto.dueDate ?? null,
        },
      ],
      { session },
    );
    if (!doc) throw new Error('Communication was not created');
    await recordAudit(
      ctx,
      {
        action: `Sent ${dto.type.toLowerCase()} ${refNo} to ${
          side ? 'the PCU' : toAllCentres ? 'all centres' : `${recipients.length} centre(s)`
        }`,
        module: MODULE,
        entityId: doc.id as string,
        centreId: side ?? undefined,
      },
      session,
    );
    return doc;
  });
};

/** One mailbox row: the communication plus the caller's view of its status. */
const summarise = (c: CommunicationDoc, side: string | null) => {
  const mine = c.receipts.find((r) => sameSide(r.centreId, side));
  const sent = sameSide(c.fromCentreId, side);
  return {
    id: String(c._id),
    refNo: c.refNo,
    type: c.type,
    subject: c.subject,
    fromCentreId: c.fromCentreId ? String(c.fromCentreId) : null,
    sentByName: c.sentByName,
    toAllCentres: c.toAllCentres,
    replyRequired: c.replyRequired,
    dueDate: c.dueDate ?? null,
    createdAt: c.createdAt,
    ...(sent
      ? {
          recipients: c.receipts.length,
          read: c.receipts.filter((r) => r.readAt).length,
          acknowledged: c.receipts.filter((r) => r.acknowledgedAt).length,
        }
      : {}),
    ...(mine ? { readAt: mine.readAt ?? null, acknowledgedAt: mine.acknowledgedAt ?? null } : {}),
  };
};

export const listCommunications = async (ctx: RequestContext, q: ListCommunicationsQuery) => {
  const side = sideOf(ctx);
  const own = trusted({ $elemMatch: { centreId: asId(side), ...ownStatus(q.status) } });
  const filter: Record<string, unknown> =
    q.box === 'inbox'
      ? { recipientKeys: sideKey(side), ...(q.status ? { receipts: own } : {}) }
      : { fromCentreId: asId(side) };
  if (q.type) filter.type = q.type;
  if (q.search) {
    const re = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ subject: re }, { refNo: re }, { body: re }];
  }
  const [rows, total] = await Promise.all([
    CommunicationModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skipFor(q.page, q.limit))
      .limit(q.limit)
      .lean<CommunicationDoc[]>(),
    CommunicationModel.countDocuments(filter),
  ]);
  const centreIds = [...new Set(rows.flatMap((r) => (r.fromCentreId ? [String(r.fromCentreId)] : [])))];
  const centres = await centresByIds(centreIds);
  return {
    items: rows.map((r) => {
      const centre = r.fromCentreId ? centres.get(String(r.fromCentreId)) : null;
      return {
        ...summarise(r, side),
        from: centre ? `${centre.code} · ${centre.name}` : 'PCU',
      };
    }),
    total,
  };
};

const ownStatus = (status: ListCommunicationsQuery['status']) =>
  status === 'unread' ? { readAt: null } : status === 'unacknowledged' ? { acknowledgedAt: null } : {};

/** The communication, if the caller's side sent or received it; others get 404. */
const findVisible = async (ctx: RequestContext, id: string) => {
  const side = sideOf(ctx);
  const c = await CommunicationModel.findById(id).lean<CommunicationDoc>();
  const sent = c && sameSide(c.fromCentreId, side);
  const received = c && c.recipientKeys.includes(sideKey(side));
  if (!c || (!sent && !received))
    throw AppError.notFound('COMMUNICATION_NOT_FOUND', 'Communication not found');
  return { c, side, sent: Boolean(sent) };
};

export const getCommunication = async (ctx: RequestContext, id: string) => {
  const { c, side, sent } = await findVisible(ctx, id);
  const centreIds = [
    ...new Set([c.fromCentreId, ...c.receipts.map((r) => r.centreId)].filter(Boolean).map(String)),
  ];
  const centres = await centresByIds(centreIds);
  const nameOf = (centreId: unknown) => {
    const centre = centreId ? centres.get(String(centreId)) : null;
    return centre ? `${centre.code} · ${centre.name}` : 'PCU';
  };
  const replyCounts = new Map(
    (
      await CommunicationReplyModel.aggregate<{ _id: Types.ObjectId | null; n: number }>([
        { $match: { communicationId: c._id } },
        { $group: { _id: '$threadCentreId', n: { $sum: 1 } } },
      ])
    ).map((x) => [sideKey(x._id), x.n]),
  );
  const receipt = (r: Communication['receipts'][number]) => ({
    centreId: r.centreId ? String(r.centreId) : null,
    name: nameOf(r.centreId),
    readAt: r.readAt ?? null,
    acknowledgedAt: r.acknowledgedAt ?? null,
    acknowledgedByName: r.acknowledgedByName ?? null,
    replies: replyCounts.get(sideKey(r.centreId)) ?? 0,
  });
  return {
    ...summarise(c, side),
    body: c.body,
    from: nameOf(c.fromCentreId),
    sent,
    // The sender sees every recipient's status; a recipient sees only its own.
    receipts: sent
      ? c.receipts.map(receipt)
      : c.receipts.filter((r) => sameSide(r.centreId, side)).map(receipt),
  };
};

/** Sets read (and acknowledged) on the caller's own receipt; repeating it changes nothing. */
const markOwn = async (ctx: RequestContext, id: string, acknowledge: boolean) => {
  const { c, side } = await findVisible(ctx, id);
  const mine = c.receipts.find((r) => sameSide(r.centreId, side));
  if (!mine) throw AppError.badRequest('NOT_A_RECIPIENT', 'You sent this communication');
  const now = new Date();
  const match = (field: 'readAt' | 'acknowledgedAt') => ({
    _id: c._id,
    receipts: trusted({ $elemMatch: { centreId: asId(side), [field]: null } }),
  });
  if (!mine.readAt) {
    await CommunicationModel.updateOne(match('readAt'), {
      $set: { 'receipts.$.readAt': now, 'receipts.$.readBy': ctx.user.id },
    });
  }
  if (acknowledge && !mine.acknowledgedAt) {
    await withTransaction(async (session) => {
      const res = await CommunicationModel.updateOne(
        match('acknowledgedAt'),
        {
          $set: {
            'receipts.$.acknowledgedAt': now,
            'receipts.$.acknowledgedBy': ctx.user.id,
            'receipts.$.acknowledgedByName': ctx.user.name,
          },
        },
        { session },
      );
      if (res.modifiedCount) {
        await recordAudit(
          ctx,
          {
            action: `Acknowledged ${c.refNo}`,
            module: MODULE,
            entityId: String(c._id),
            centreId: side ?? undefined,
          },
          session,
        );
      }
    });
  }
  return getCommunication(ctx, id);
};

export const markRead = (ctx: RequestContext, id: string) => markOwn(ctx, id, false);
export const acknowledgeCommunication = (ctx: RequestContext, id: string) => markOwn(ctx, id, true);

/**
 * Replies form one thread per recipient. A recipient always writes in its own thread; the sender
 * names the recipient centre (`centreId`), which is optional when there is only one recipient.
 */
const threadOf = (
  c: CommunicationDoc,
  side: string | null,
  sent: boolean,
  centreId: string | undefined,
): string | null => {
  if (!sent) return side;
  if (centreId) {
    if (!c.recipientKeys.includes(centreId))
      throw AppError.badRequest('NOT_A_RECIPIENT', 'That centre did not receive this communication');
    return centreId;
  }
  if (c.receipts.length === 1) return c.receipts[0]!.centreId ? String(c.receipts[0]!.centreId) : null;
  throw AppError.badRequest('THREAD_REQUIRED', 'Name the recipient centre whose thread to use');
};

export const listReplies = async (ctx: RequestContext, id: string, centreId?: string) => {
  const { c, side, sent } = await findVisible(ctx, id);
  const thread = threadOf(c, side, sent, centreId);
  const replies = await CommunicationReplyModel.find({
    communicationId: c._id,
    threadCentreId: asId(thread),
  }).sort({ createdAt: 1 });
  return replies.map((r) => ({
    id: r.id as string,
    body: r.body,
    fromCentreId: r.fromCentreId ? String(r.fromCentreId) : null,
    mine: sameSide(r.fromCentreId, side),
    createdByName: r.createdByName,
    createdAt: r.createdAt,
  }));
};

export const replyToCommunication = async (
  ctx: RequestContext,
  id: string,
  body: string,
  centreId?: string,
) => {
  const { c, side, sent } = await findVisible(ctx, id);
  const thread = threadOf(c, side, sent, centreId);
  if (!sent) await markRead(ctx, id);
  await withTransaction(async (session) => {
    const [reply] = await CommunicationReplyModel.create(
      [
        {
          communicationId: c._id,
          threadCentreId: asId(thread),
          fromCentreId: asId(side),
          body,
          createdBy: ctx.user.id,
          createdByName: ctx.user.name,
        },
      ],
      { session },
    );
    if (!reply) throw new Error('Reply was not created');
    await recordAudit(
      ctx,
      {
        action: `Replied to ${c.refNo}`,
        module: MODULE,
        entityId: String(c._id),
        centreId: thread ?? side ?? undefined,
      },
      session,
    );
  });
  return listReplies(ctx, id, centreId);
};

/** For the navigation badge: inbox items the caller's side hasn't opened yet. */
export const unreadCount = async (ctx: RequestContext) => {
  const side = sideOf(ctx);
  const unread = await CommunicationModel.countDocuments({
    recipientKeys: sideKey(side),
    receipts: trusted({ $elemMatch: { centreId: asId(side), readAt: null } }),
  });
  return { unread };
};

export { PCU_KEY };
