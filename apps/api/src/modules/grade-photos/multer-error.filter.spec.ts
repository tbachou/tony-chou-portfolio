import {
  ConflictException,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';
import { isFileTooLarge, MulterErrorFilter } from './multer-error.filter';

function makeHost() {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('MulterErrorFilter (AC-17)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('turns multer\'s size abort into 413', async () => {
    // The cap is enforced as the stream arrives rather than after buffering,
    // which is what keeps a huge upload from becoming an out-of-memory kill
    // on a free instance. The cost is that the failure arrives as a raw
    // multer error, which Nest would otherwise render as a 500.
    const { host, response } = makeHost();

    new MulterErrorFilter().catch(
      Object.assign(new Error('File too large'), { code: 'LIMIT_FILE_SIZE' }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(413);
    expect(JSON.stringify(response.json.mock.calls[0][0])).toContain('10 MB');
  });

  it('passes a normal HttpException through with its own status', async () => {
    const { host, response } = makeHost();

    new MulterErrorFilter().catch(new ConflictException('taken'), host);

    expect(response.status).toHaveBeenCalledWith(409);
  });

  it('renders an unknown failure as a bare 500 that echoes nothing', async () => {
    // No visitor-supplied text is ever logged or returned by this api, and an
    // upload error is exactly the kind that could carry request content in
    // its message.
    const { host, response } = makeHost();

    new MulterErrorFilter().catch(
      new Error('secret filename: /home/tony/private.jpg'),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(response.json.mock.calls[0][0])).not.toContain(
      'private.jpg',
    );
  });

  it('logs the error name only, never its message', () => {
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { host } = makeHost();

    new MulterErrorFilter().catch(
      Object.assign(new Error('/home/tony/private.jpg'), { name: 'TypeError' }),
      host,
    );

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('TypeError');
    expect(log.mock.calls[0][0]).not.toContain('private.jpg');
  });
});

describe('isFileTooLarge', () => {
  it('recognises only multer\'s size code', () => {
    expect(isFileTooLarge({ code: 'LIMIT_FILE_SIZE' })).toBe(true);
    expect(isFileTooLarge({ code: 'LIMIT_UNEXPECTED_FILE' })).toBe(false);
    expect(isFileTooLarge(new Error('nope'))).toBe(false);
    expect(isFileTooLarge(null)).toBe(false);
  });
});
