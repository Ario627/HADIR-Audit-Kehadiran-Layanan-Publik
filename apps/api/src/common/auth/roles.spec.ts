import { PARTNER_ROLES, roleSatisfies, rolesSatisfy, strongestRole } from './roles';

describe('role hierarchy', () => {
  it('lets admin do everything a responder can', () => {
    expect(roleSatisfies('admin', 'responder')).toBe(true);
    expect(roleSatisfies('admin', 'viewer')).toBe(true);
  });

  it('lets a responder act but not administer', () => {
    expect(roleSatisfies('responder', 'viewer')).toBe(true);
    expect(roleSatisfies('responder', 'admin')).toBe(false);
  });

  it('keeps a viewer read-only', () => {
    expect(roleSatisfies('viewer', 'viewer')).toBe(true);
    expect(roleSatisfies('viewer', 'responder')).toBe(false);
  });

  it('treats an empty requirement as satisfied', () => {
    expect(rolesSatisfy('viewer', [])).toBe(true);
  });

  it('accepts any one of the listed roles', () => {
    expect(rolesSatisfy('responder', ['viewer', 'responder'])).toBe(true);
    expect(rolesSatisfy('viewer', ['responder', 'admin'])).toBe(false);
  });

  it('picks the strongest role from a list', () => {
    expect(strongestRole(['viewer', 'admin', 'responder'])).toBe('admin');
    expect(strongestRole([])).toBeNull();
  });

  it('exposes the role ladder in ascending order', () => {
    expect(PARTNER_ROLES).toEqual(['viewer', 'responder', 'admin']);
  });
});
