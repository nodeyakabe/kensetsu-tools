/**
 * GET /api/trial?product=koji|anzen|pc-tenken
 * 体験版ファイルをR2からストリーミングダウンロードする。
 * env var: TRIAL_OBJECT_KEY_KOJI / TRIAL_OBJECT_KEY_ANZEN / TRIAL_OBJECT_KEY_PCTENKEN
 *
 * 運用メモ: available:false の間は TRIAL_OBJECT_KEY_* を未設定にしておくこと（404で弾かれる）。
 * available:true にするタイミングで env var を設定する。
 */

const CONFIGS = {
  koji: {
    envKey: 'TRIAL_OBJECT_KEY_KOJI',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filename: 'trial_koji.xlsx',
    filenameEncoded:
      '%E3%82%B7%E3%83%B3%E3%83%97%E3%83%AB%E5%B7%A5%E4%BA%8B%E5%8F%B0%E5%B8%B3_%E4%BD%93%E9%A8%93%E7%89%88.xlsx',
  },
  anzen: {
    envKey: 'TRIAL_OBJECT_KEY_ANZEN',
    contentType: 'application/zip',
    filename: 'trial_anzen.zip',
    filenameEncoded:
      '%E3%82%B7%E3%83%B3%E3%83%97%E3%83%AB%E5%AE%89%E5%85%A8%E5%8F%B0%E5%B8%B3_%E4%BD%93%E9%A8%93%E7%89%88.zip',
  },
  'pc-tenken': {
    envKey: 'TRIAL_OBJECT_KEY_PCTENKEN',
    contentType: 'application/zip',
    filename: 'trial_pc-tenken.zip',
    filenameEncoded:
      'PC%E3%82%BB%E3%82%AD%E3%83%A5%E3%83%AA%E3%83%86%E3%82%A3%E7%82%B9%E6%A4%9C2026%E5%B9%B4%E7%89%88_%E4%BD%93%E9%A8%93%E7%89%88.zip',
  },
};

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET' },
    });
  }

  const url = new URL(request.url);
  const product = url.searchParams.get('product');

  if (!product || !CONFIGS[product]) {
    return new Response(JSON.stringify({ error: 'invalid product' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const config = CONFIGS[product];
  const objectKey = env[config.envKey];

  if (!objectKey) {
    return new Response(JSON.stringify({ error: 'not configured' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!env.PRODUCT_BUCKET) {
    return new Response(JSON.stringify({ error: 'storage not available' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const obj = await env.PRODUCT_BUCKET.get(objectKey);
    if (!obj) {
      return new Response(JSON.stringify({ error: 'file not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(obj.body, {
      headers: {
        'Content-Type': config.contentType,
        'Content-Disposition': `attachment; filename="${config.filename}"; filename*=UTF-8''${config.filenameEncoded}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'storage error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
