import { detectShoppingCategory } from './clarification';

describe('detectShoppingCategory', () => {
  it.each([
    'Find koshary near me',
    'Compare burgers close to me',
    'Show shawerma menu prices',
    'Find pizza nearby',
  ])('detects requested food example: %s', (request) => {
    expect(detectShoppingCategory(request)).toBe('food');
  });
});
