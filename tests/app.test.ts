import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './helpers.js';

describe('app plumbing', () => {
  it('reports health and readiness', async () => {
    await request(app).get('/health').expect(200);
    const ready = await request(app).get('/ready').expect(200);
    expect(ready.body.data.database).toBe('connected');
  });

  it('returns the error envelope with a request id for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nope').expect(404);
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'ROUTE_NOT_FOUND', requestId: res.headers['x-request-id'] },
    });
  });

  it('reuses a well-formed incoming X-Request-Id', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'lb-trace-123');
    expect(res.headers['x-request-id']).toBe('lb-trace-123');
  });

  it('rejects malformed JSON with a 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);
    expect(res.body.error.code).toBe('MALFORMED_JSON');
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
