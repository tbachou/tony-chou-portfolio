import { parseClassification } from './classify';

describe('parseClassification', () => {
  it('parses a well-formed response', () => {
    const text = JSON.stringify({ label: 'bug', summary: 'form is broken' });
    expect(parseClassification(text)).toEqual({ label: 'bug', summary: 'form is broken' });
  });

  it('falls back to unclassified on invalid JSON', () => {
    expect(parseClassification('not { valid json')).toEqual({
      label: 'unclassified',
      summary: '',
    });
  });

  it('falls back to unclassified when the label is not one of the allowed values', () => {
    const text = JSON.stringify({ label: 'spam', summary: 'whatever' });
    expect(parseClassification(text)).toEqual({ label: 'unclassified', summary: '' });
  });

  it('falls back to unclassified when summary is missing', () => {
    const text = JSON.stringify({ label: 'praise' });
    expect(parseClassification(text)).toEqual({ label: 'unclassified', summary: '' });
  });

  it('falls back to unclassified when the response is not an object', () => {
    expect(parseClassification(JSON.stringify('just a string'))).toEqual({
      label: 'unclassified',
      summary: '',
    });
  });

  it('falls back to unclassified on undefined input', () => {
    expect(parseClassification(undefined)).toEqual({ label: 'unclassified', summary: '' });
  });
});
