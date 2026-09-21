import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebhookService } from './WebhookService.js';

function makeRepo(overrides: Record<string, any> = {}) {
  return {
    create: vi.fn(),
    findAll: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findActiveForEvent: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as any;
}

function makeDeliveryRepo(overrides: Record<string, any> = {}) {
  return {
    create: vi.fn().mockImplementation((data) => Promise.resolve({ id: 'delivery-1', ...data })),
    findById: vi.fn(),
    list: vi.fn(),
    ...overrides,
  } as any;
}

const HOOK = { id: 'hook-1', url: 'https://example.com/hook', secret: null } as any;
const HOOK_WITH_SECRET = { id: 'hook-2', url: 'https://example.com/hook', secret: 'sekret' } as any;

describe('WebhookService.dispatchAndRecord (via retry)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not attach a signature header when the hook has no secret', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const deliveryRepo = makeDeliveryRepo();
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(HOOK),
    });
    const service = new WebhookService(repo, deliveryRepo);
    deliveryRepo.findById.mockResolvedValue({
      id: 'd1',
      webhookId: HOOK.id,
      eventType: 'invoice.created',
      payload: { foo: 'bar' },
    });

    await service.retry('d1');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['X-LoopNest-Signature']).toBeUndefined();
  });

  it('attaches a sha256= HMAC signature header when the hook has a secret', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const deliveryRepo = makeDeliveryRepo();
    const repo = makeRepo({
      findById: vi.fn().mockResolvedValue(HOOK_WITH_SECRET),
    });
    const service = new WebhookService(repo, deliveryRepo);
    deliveryRepo.findById.mockResolvedValue({
      id: 'd1',
      webhookId: HOOK_WITH_SECRET.id,
      eventType: 'invoice.created',
      payload: { foo: 'bar' },
    });

    await service.retry('d1');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['X-LoopNest-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('records a success delivery when the response is ok', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const deliveryRepo = makeDeliveryRepo();
    const repo = makeRepo({ findById: vi.fn().mockResolvedValue(HOOK) });
    const service = new WebhookService(repo, deliveryRepo);
    deliveryRepo.findById.mockResolvedValue({
      id: 'd1',
      webhookId: HOOK.id,
      eventType: 'invoice.created',
      payload: {},
    });

    const record = await service.retry('d1');

    expect(record.status).toBe('success');
    expect(deliveryRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', httpStatus: 200, errorMessage: null }),
    );
  });

  it('records a failed delivery and throws when the response is not ok', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const deliveryRepo = makeDeliveryRepo();
    const repo = makeRepo({ findById: vi.fn().mockResolvedValue(HOOK) });
    const service = new WebhookService(repo, deliveryRepo);
    deliveryRepo.findById.mockResolvedValue({
      id: 'd1',
      webhookId: HOOK.id,
      eventType: 'invoice.created',
      payload: {},
    });

    await expect(service.retry('d1')).rejects.toThrow('HTTP 500');
    expect(deliveryRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', httpStatus: 500, errorMessage: 'HTTP 500' }),
    );
  });

  it('records a network_error delivery and throws when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'));
    const deliveryRepo = makeDeliveryRepo();
    const repo = makeRepo({ findById: vi.fn().mockResolvedValue(HOOK) });
    const service = new WebhookService(repo, deliveryRepo);
    deliveryRepo.findById.mockResolvedValue({
      id: 'd1',
      webhookId: HOOK.id,
      eventType: 'invoice.created',
      payload: {},
    });

    await expect(service.retry('d1')).rejects.toThrow('fetch failed');
    expect(deliveryRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', httpStatus: null, errorMessage: 'fetch failed' }),
    );
  });
});

describe('WebhookService.retry', () => {
  it('throws NOT_FOUND when the delivery does not exist', async () => {
    const deliveryRepo = makeDeliveryRepo({ findById: vi.fn().mockResolvedValue(null) });
    const repo = makeRepo();
    const service = new WebhookService(repo, deliveryRepo);

    await expect(service.retry('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws NOT_FOUND when the webhook is not accessible for the org', async () => {
    const deliveryRepo = makeDeliveryRepo({
      findById: vi.fn().mockResolvedValue({
        id: 'd1',
        webhookId: 'hook-1',
        eventType: 'invoice.created',
        payload: {},
      }),
    });
    const repo = makeRepo({ findById: vi.fn().mockResolvedValue(null) });
    const service = new WebhookService(repo, deliveryRepo);

    await expect(service.retry('d1', 'other-org')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('WebhookService.deliver', () => {
  it('is a no-op when orgId is undefined', async () => {
    const repo = makeRepo();
    const deliveryRepo = makeDeliveryRepo();
    const service = new WebhookService(repo, deliveryRepo);

    await service.deliver(undefined, 'invoice.created', {});

    expect(repo.findActiveForEvent).not.toHaveBeenCalled();
  });

  it('does not propagate errors from individual hook dispatch failures (fire-and-forget)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('boom')),
    );
    const repo = makeRepo({
      findActiveForEvent: vi.fn().mockResolvedValue([HOOK, HOOK_WITH_SECRET]),
    });
    const deliveryRepo = makeDeliveryRepo();
    const service = new WebhookService(repo, deliveryRepo);

    await expect(service.deliver('org-1', 'invoice.created', {})).resolves.toBeUndefined();

    // let the fire-and-forget dispatch() promises settle before asserting.
    await new Promise((r) => setTimeout(r, 0));
    expect(deliveryRepo.create).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
