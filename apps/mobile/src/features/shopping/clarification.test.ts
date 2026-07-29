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

  it.each([
    'Find a Samsung A55 256 GB under 25,000 EGP, delivered by Thursday',
    'Need a Galaxy A55 by Thursday',
    'A55 256GB max 25,000 EGP',
  ])('detects a human retail request without the word phone: %s', (request) => {
    expect(detectShoppingCategory(request)).toBe('retail');
  });
});
