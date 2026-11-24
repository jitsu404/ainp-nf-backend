import { Schema, type Types, model } from 'mongoose';

// Communication & correspondence (SOW: circulars, letters, guidelines, reminders, meeting notices;
// centre-wise dissemination; acknowledgement / read status; replies; searchable archive).
//
// Mail belongs to a side, not a person: the PCU (centreId null) or a centre. Every PCU user works
// the PCU's inbox, every user of a centre works that centre's. The PCU writes to all or chosen
// centres; a centre writes to the PCU (letters, issues). Each recipient has a receipt holding its
// read and acknowledgement status; replies are a thread per recipient (communicationreplies).

export const COMMUNICATION_TYPES = [
  'Circular',
  'Letter',
  'Guideline',
  'Reminder',
  'Meeting notice',
  'Notification',
  'Issue',
] as const;
export type CommunicationType = (typeof COMMUNICATION_TYPES)[number];

/** What a centre may send to the PCU. */
export const CENTRE_TYPES_TO_PCU: readonly CommunicationType[] = ['Letter', 'Issue'];

/** The PCU as a recipient or sender side in `recipientKeys`. */
export const PCU_KEY = 'PCU';
export const sideKey = (centreId: Types.ObjectId | string | null | undefined): string =>
  centreId ? String(centreId) : PCU_KEY;

/** One recipient: a centre, or the PCU (centreId null). */
export interface Receipt {
  centreId: Types.ObjectId | null;
  readAt?: Date | null;
  readBy?: Types.ObjectId | null;
  acknowledgedAt?: Date | null;
  acknowledgedBy?: Types.ObjectId | null;
  acknowledgedByName?: string | null;
}

export interface Communication {
  /** AINP-NF/COMM/2026/001: numbered per calendar year. */
  refNo: string;
  type: CommunicationType;
  subject: string;
  body: string;
  /** The sending side: a centre, or the PCU (null). */
  fromCentreId: Types.ObjectId | null;
  sentBy: Types.ObjectId;
  /** Snapshot, so the record stays readable after people leave. */
  sentByName: string;
  /** Addressed to every active centre at the time of sending. */
  toAllCentres: boolean;
  receipts: Receipt[];
  /** The recipient sides, for queries: centre ids, or 'PCU'. */
  recipientKeys: string[];
  replyRequired: boolean;
  dueDate?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CommunicationReply {
  communicationId: Types.ObjectId;
  /** The recipient's thread the reply belongs to: a centre, or the PCU (null). */
  threadCentreId: Types.ObjectId | null;
  /** Who wrote it: a centre, or the PCU (null). */
  fromCentreId: Types.ObjectId | null;
  body: string;
  createdBy: Types.ObjectId;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
}

const receiptSchema = new Schema<Receipt>(
  {
    centreId: { type: Schema.Types.ObjectId, ref: 'Centre', default: null },
    readAt: { type: Date, default: null },
    readBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    acknowledgedAt: { type: Date, default: null },
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    acknowledgedByName: { type: String, default: null },
  },
  { _id: false },
);

const communicationSchema = new Schema<Communication>(
  {
    refNo: { type: String, required: true, trim: true },
    type: { type: String, enum: COMMUNICATION_TYPES, required: true },
    subject: { type: String, required: true, trim: true, maxlength: 300 },
    body: { type: String, required: true, trim: true, maxlength: 20000 },
    fromCentreId: { type: Schema.Types.ObjectId, ref: 'Centre', default: null },
    sentBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sentByName: { type: String, required: true },
    toAllCentres: { type: Boolean, default: false },
    receipts: { type: [receiptSchema], default: [] },
    recipientKeys: { type: [String], default: [] },
    replyRequired: { type: Boolean, default: false },
    dueDate: { type: Date, default: null },
  },
  { timestamps: true },
);

communicationSchema.index({ refNo: 1 }, { unique: true });
communicationSchema.index({ recipientKeys: 1, createdAt: -1 });
communicationSchema.index({ fromCentreId: 1, createdAt: -1 });

const replySchema = new Schema<CommunicationReply>(
  {
    communicationId: { type: Schema.Types.ObjectId, ref: 'Communication', required: true },
    threadCentreId: { type: Schema.Types.ObjectId, ref: 'Centre', default: null },
    fromCentreId: { type: Schema.Types.ObjectId, ref: 'Centre', default: null },
    body: { type: String, required: true, trim: true, maxlength: 10000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, required: true },
  },
  { timestamps: true },
);

replySchema.index({ communicationId: 1, threadCentreId: 1, createdAt: 1 });

export const CommunicationModel = model<Communication>('Communication', communicationSchema);
export const CommunicationReplyModel = model<CommunicationReply>('CommunicationReply', replySchema);
