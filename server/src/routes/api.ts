import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../config.js';
import { tgAuth } from '../middleware/tgAuth.js';
import {
  ServiceError,
  getItemsService,
  type CreateItemInput,
  type UpdateItemInput,
} from '../services/items.service.js';

const itemType = z.enum(['blink', 'note']);
const itemStatus = z.enum(['active', 'archived']);

const createItemSchema = z
  .object({
    type: itemType.optional(),
    title: z.string().max(300).nullable().optional(),
    content: z.string().trim().min(1, 'content must be a non-empty string').max(100_000),
    tags: z.array(z.string().max(80)).max(100).optional(),
    meta: z.record(z.unknown()).optional(),
  })
  .strict();

const updateItemSchema = z
  .object({
    type: itemType.optional(),
    title: z.string().max(300).nullable().optional(),
    content: z.string().trim().min(1, 'content must be a non-empty string').max(100_000).optional(),
    status: itemStatus.optional(),
    isPinned: z.boolean().optional(),
    tags: z.array(z.string().max(80)).max(100).optional(),
    meta: z.record(z.unknown()).optional(),
  })
  .strict();

function validationResponse(error: z.ZodError): { error: string; issues: string[] } {
  const issues = error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  return { error: issues[0] ?? 'Invalid request body', issues };
}

async function parseJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ServiceError('Request body must be valid JSON');
  }
}

export const apiRoutes = new Hono();

apiRoutes.get('/health', (c) =>
  c.json({ ok: true, botMode: config.BOT_MODE }),
);

// Exact and wildcard forms are both registered so /items and /items/:id are
// protected on every Hono version.
apiRoutes.use('/items', tgAuth);
apiRoutes.use('/items/*', tgAuth);
apiRoutes.use('/tags', tgAuth);
apiRoutes.use('/tags/*', tgAuth);

apiRoutes.get('/items', (c) => {
  const service = getItemsService();
  const { type, status, tag, q, limit, offset } = c.req.query();

  if (type !== undefined && !itemType.safeParse(type).success) {
    return c.json({ error: 'type must be "blink" or "note"' }, 400);
  }
  if (status !== undefined && !itemStatus.safeParse(status).success) {
    return c.json({ error: 'status must be "active" or "archived"' }, 400);
  }

  const parsedLimit = limit === undefined ? 50 : Number(limit);
  const parsedOffset = offset === undefined ? 0 : Number(offset);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
    return c.json({ error: 'limit must be a positive integer' }, 400);
  }
  if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
    return c.json({ error: 'offset must be a non-negative integer' }, 400);
  }

  const page = service.list({
    ...(type ? { type: itemType.parse(type) } : {}),
    status: status ? itemStatus.parse(status) : 'active',
    ...(tag ? { tag } : {}),
    ...(q ? { q } : {}),
    limit: Math.min(parsedLimit, 200),
    offset: parsedOffset,
  });

  return c.json(page);
});

apiRoutes.get('/items/:id', (c) => {
  const item = getItemsService().get(c.req.param('id'));
  if (!item) return c.json({ error: 'Item not found' }, 404);
  return c.json(item);
});

apiRoutes.post('/items', async (c) => {
  const body = await parseJson(c);
  const parsed = createItemSchema.safeParse(body);
  if (!parsed.success) return c.json(validationResponse(parsed.error), 400);

  const item = getItemsService().create(parsed.data as CreateItemInput);
  return c.json(item, 201);
});

apiRoutes.patch('/items/:id', async (c) => {
  const body = await parseJson(c);
  const parsed = updateItemSchema.safeParse(body);
  if (!parsed.success) return c.json(validationResponse(parsed.error), 400);

  const item = getItemsService().update(
    c.req.param('id'),
    parsed.data as UpdateItemInput,
  );
  if (!item) return c.json({ error: 'Item not found' }, 404);
  return c.json(item);
});

apiRoutes.delete('/items/:id', (c) => {
  const id = c.req.param('id');
  if (!getItemsService().remove(id)) {
    return c.json({ error: 'Item not found' }, 404);
  }
  return c.json({ deleted: true, id });
});

apiRoutes.get('/tags', (c) => {
  const { type, status } = c.req.query();
  if (type !== undefined && !itemType.safeParse(type).success) {
    return c.json({ error: 'type must be "blink" or "note"' }, 400);
  }
  if (status !== undefined && !itemStatus.safeParse(status).success) {
    return c.json({ error: 'status must be "active" or "archived"' }, 400);
  }

  const tags = getItemsService().tags({
    ...(type ? { type: itemType.parse(type) } : {}),
    status: status ? itemStatus.parse(status) : 'active',
  });
  return c.json({ tags });
});

apiRoutes.onError((error, c) => {
  if (error instanceof ServiceError) {
    return c.json({ error: error.message }, error.status);
  }
  console.error('[API] Unhandled error:', error);
  return c.json({ error: 'Internal server error' }, 500);
});

apiRoutes.notFound((c) => c.json({ error: 'API route not found' }, 404));
