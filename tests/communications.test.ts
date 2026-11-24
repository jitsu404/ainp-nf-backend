import { describe, expect, it } from 'vitest';
import { createCentre, signedInAgent } from './helpers.js';

const setup = async () => {
  const centreA = await createCentre();
  const centreB = await createCentre();
  const { agent: pcu } = await signedInAgent('pc');
  const { agent: piA } = await signedInAgent('pi', centreA.id);
  const { agent: piB } = await signedInAgent('pi', centreB.id);
  return { pcu, piA, piB, centreA, centreB };
};

const circular = {
  type: 'Circular',
  subject: 'Submission of Kharif 2026 data',
  body: 'All centres are requested to submit the Kharif 2026 observation sheets.',
  replyRequired: true,
};

describe('communications', () => {
  it('the PCU sends to all centres; each centre reads, acknowledges and replies in its own thread', async () => {
    const { pcu, piA, piB, centreA } = await setup();
    const sent = await pcu
      .post('/api/v1/communications')
      .send({ ...circular, toAllCentres: true })
      .expect(201);
    const id = sent.body.data.id as string;
    expect(sent.body.data.refNo).toBe(`AINP-NF/COMM/${new Date().getFullYear()}/001`);
    expect(sent.body.data.receipts).toHaveLength(2);

    expect((await piA.get('/api/v1/communications/unread-count').expect(200)).body.data.unread).toBe(1);
    const inbox = await piA.get('/api/v1/communications?box=inbox').expect(200);
    expect(inbox.body.data).toHaveLength(1);
    expect(inbox.body.data[0]).toMatchObject({ refNo: sent.body.data.refNo, from: 'PCU', readAt: null });

    // A recipient sees only its own status.
    const opened = await piA.post(`/api/v1/communications/${id}/read`).expect(200);
    expect(opened.body.data.receipts).toHaveLength(1);
    expect(opened.body.data.receipts[0].readAt).not.toBeNull();
    expect((await piA.get('/api/v1/communications/unread-count').expect(200)).body.data.unread).toBe(0);

    const acked = await piA.post(`/api/v1/communications/${id}/acknowledge`).expect(200);
    expect(acked.body.data.acknowledgedAt).not.toBeNull();

    await piA
      .post(`/api/v1/communications/${id}/replies`)
      .send({ body: 'Data will be sent by Friday.' })
      .expect(201);

    // The PCU sees every centre's status and reply count, and replies in centre A's thread.
    const detail = await pcu.get(`/api/v1/communications/${id}`).expect(200);
    const a = detail.body.data.receipts.find((r: { centreId: string }) => r.centreId === centreA.id);
    expect(a).toMatchObject({ replies: 1 });
    expect(a.acknowledgedAt).not.toBeNull();
    expect(detail.body.data).toMatchObject({ recipients: 2, read: 1, acknowledged: 1 });
    const noThread = await pcu
      .post(`/api/v1/communications/${id}/replies`)
      .send({ body: 'Thanks' })
      .expect(400);
    expect(noThread.body.error.code).toBe('THREAD_REQUIRED');
    await pcu
      .post(`/api/v1/communications/${id}/replies?centreId=${centreA.id}`)
      .send({ body: 'Noted, thank you.' })
      .expect(201);
    const thread = await piA.get(`/api/v1/communications/${id}/replies`).expect(200);
    expect(thread.body.data.map((r: { body: string }) => r.body)).toEqual([
      'Data will be sent by Friday.',
      'Noted, thank you.',
    ]);

    // Centre B has its own (empty) thread and can't see centre A's.
    expect((await piB.get(`/api/v1/communications/${id}/replies`).expect(200)).body.data).toEqual([]);
    const pending = await pcu.get('/api/v1/communications?box=sent').expect(200);
    expect(pending.body.data[0]).toMatchObject({ recipients: 2, acknowledged: 1 });
  });

  it('a centre writes a letter or issue to the PCU only', async () => {
    const { pcu, piA, centreB } = await setup();
    const letter = await piA
      .post('/api/v1/communications')
      .send({ type: 'Issue', subject: 'Delay in fund release', body: 'Funds for Q2 not received.' })
      .expect(201);
    const inbox = await pcu.get('/api/v1/communications?box=inbox&status=unread').expect(200);
    expect(inbox.body.data).toHaveLength(1);
    expect(inbox.body.data[0].id).toBe(letter.body.data.id);

    // Only one recipient (the PCU), so the sender centre and the PCU share one thread.
    await pcu
      .post(`/api/v1/communications/${letter.body.data.id}/replies`)
      .send({ body: 'Being processed.' })
      .expect(201);
    const thread = await piA.get(`/api/v1/communications/${letter.body.data.id}/replies`).expect(200);
    expect(thread.body.data[0]).toMatchObject({ body: 'Being processed.', mine: false });

    const circularFromCentre = await piA.post('/api/v1/communications').send(circular).expect(400);
    expect(circularFromCentre.body.error.code).toBe('TYPE_NOT_ALLOWED');
    const toCentre = await piA
      .post('/api/v1/communications')
      .send({ type: 'Letter', subject: 'Hello', body: 'Hi', centreIds: [centreB.id] })
      .expect(400);
    expect(toCentre.body.error.code).toBe('CENTRE_TO_PCU_ONLY');
  });

  it('other centres never see a communication they are not party to', async () => {
    const { pcu, piB, centreA } = await setup();
    const sent = await pcu
      .post('/api/v1/communications')
      .send({ ...circular, centreIds: [centreA.id] })
      .expect(201);
    await piB.get(`/api/v1/communications/${sent.body.data.id}`).expect(404);
    expect((await piB.get('/api/v1/communications').expect(200)).body.data).toEqual([]);
  });

  it('refuses roles without a mailbox, bad input and empty recipient lists', async () => {
    const { pcu } = await setup();
    const { agent: epi } = await signedInAgent('epi');
    await epi.get('/api/v1/communications').expect(403);
    await pcu
      .post('/api/v1/communications')
      .send({ ...circular, subject: 'Hi' })
      .expect(400);
    const none = await pcu
      .post('/api/v1/communications')
      .send({ ...circular, centreIds: [] })
      .expect(400);
    expect(none.body.error.code).toBe('NO_RECIPIENTS');
  });

  it('searches the archive by subject or reference', async () => {
    const { pcu } = await setup();
    await pcu
      .post('/api/v1/communications')
      .send({ ...circular, toAllCentres: true })
      .expect(201);
    await pcu
      .post('/api/v1/communications')
      .send({
        type: 'Meeting notice',
        subject: 'Annual group meeting',
        body: 'Venue: Modipuram',
        toAllCentres: true,
      })
      .expect(201);
    const found = await pcu.get('/api/v1/communications?box=sent&search=annual').expect(200);
    expect(found.body.data.map((c: { subject: string }) => c.subject)).toEqual(['Annual group meeting']);
    const byType = await pcu.get('/api/v1/communications?box=sent&type=Circular').expect(200);
    expect(byType.body.data).toHaveLength(1);
  });
});
