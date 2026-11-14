import { describe, expect, it } from 'vitest';
import { UserModel } from '../src/modules/users/users.model.js';
import { composeName, splitName } from '../src/modules/users/users.names.js';
import { createCentre, newPerson, signedInAgent } from './helpers.js';

// User details follow the PCU master table ("Users" sheet):
// Title | First Name | Middle Name | Surname | Designation | Email | Mobile | Organization Name.

describe('user details from the PCU master table', () => {
  it('stores every field and builds the display name from the parts', async () => {
    const centre = await createCentre();
    const { agent } = await signedInAgent('pc');
    const res = await agent
      .post(`/api/v1/centres/${centre.id}/pi`)
      .send(
        newPerson({
          title: 'Dr',
          firstName: 'Sujit',
          middleName: 'Kumar',
          surname: 'Singh',
          designation: 'Chief Agronomist',
          mobile: '98765 43210',
          organization: 'ICAR-Indian Institute of Soil Science, Bhopal',
        }),
      )
      .expect(201);

    expect(res.body.data).toMatchObject({
      name: 'Dr. Sujit Kumar Singh',
      title: 'Dr',
      firstName: 'Sujit',
      middleName: 'Kumar',
      surname: 'Singh',
      designation: 'Chief Agronomist',
      mobile: '98765 43210',
      organization: 'ICAR-Indian Institute of Soil Science, Bhopal',
    });
  });

  it('allows a person without a middle name or surname', async () => {
    const { agent } = await signedInAgent('superadmin');
    const body = newPerson({ roleId: 'pc', firstName: 'Ravisankar' });
    delete (body as Record<string, unknown>).surname;
    const res = await agent.post('/api/v1/users').send(body).expect(201);
    expect(res.body.data.name).toBe('Dr. Ravisankar');
  });

  it('requires title, first name, designation, email, mobile and organization', async () => {
    const { agent } = await signedInAgent('superadmin');
    const res = await agent
      .post('/api/v1/users')
      .send({ roleId: 'pc', temporaryPassword: 'Temporary12345' })
      .expect(400);
    const missing = Object.keys(res.body.error.details.body.fieldErrors);
    expect(missing).toEqual(
      expect.arrayContaining(['title', 'firstName', 'designation', 'email', 'mobile', 'organization']),
    );
    expect(missing).not.toContain('middleName');
    expect(missing).not.toContain('surname');
  });

  it.each([
    ['mobile', '12345'],
    ['mobile', '5876543210'], // Indian mobiles start with 6–9
    ['title', 'Sir'],
    ['firstName', 'R2D2'],
  ])('rejects an invalid %s (%s)', async (field, value) => {
    const { agent } = await signedInAgent('superadmin');
    const res = await agent
      .post('/api/v1/users')
      .send(newPerson({ roleId: 'pc', [field]: value }))
      .expect(400);
    expect(res.body.error.details.body.fieldErrors[field]).toBeDefined();
  });

  it('accepts the common ways of writing an Indian mobile number', async () => {
    const { agent } = await signedInAgent('superadmin');
    for (const mobile of ['9876543210', '+91 98765 43210', '+91-9876543210', '09876543210']) {
      await agent
        .post('/api/v1/users')
        .send(newPerson({ roleId: 'pc', mobile }))
        .expect(201);
    }
  });

  it('rebuilds the display name when name parts are edited, and can clear a middle name', async () => {
    const centre = await createCentre();
    const { agent } = await signedInAgent('pc');
    const created = await agent
      .post(`/api/v1/centres/${centre.id}/pi`)
      .send(newPerson({ firstName: 'Anil', middleName: 'Kumar', surname: 'Verma' }))
      .expect(201);

    const updated = await agent
      .patch(`/api/v1/users/${created.body.data.id}`)
      .send({ title: 'Prof', middleName: null, surname: 'Sharma' })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      name: 'Prof. Anil Sharma',
      middleName: null,
      surname: 'Sharma',
    });
    expect((await UserModel.findById(created.body.data.id))?.name).toBe('Prof. Anil Sharma');
  });
});

describe('name helpers', () => {
  it('composes the display name, skipping empty parts', () => {
    expect(composeName({ title: 'Mrs', firstName: 'Anita', middleName: null, surname: 'Bhatia' })).toBe(
      'Mrs. Anita Bhatia',
    );
    expect(composeName({ title: null, firstName: 'Super', surname: 'Admin' })).toBe('Super Admin');
  });

  it.each([
    ['Dr. A. K. Sharma', { title: 'Dr', firstName: 'A.', middleName: 'K.', surname: 'Sharma' }],
    ['Dr Sujit Kumar', { title: 'Dr', firstName: 'Sujit', middleName: null, surname: 'Kumar' }],
    ['mrs anita bhatia', { title: 'Mrs', firstName: 'anita', middleName: null, surname: 'bhatia' }],
    ['Ravisankar', { title: null, firstName: 'Ravisankar', middleName: null, surname: null }],
    [
      'Prof.  N  Ravi   Sankar Rao',
      { title: 'Prof', firstName: 'N', middleName: 'Ravi Sankar', surname: 'Rao' },
    ],
  ])('splits an old single-field name: %s', (input, expected) => {
    expect(splitName(input)).toEqual(expected);
  });
});
