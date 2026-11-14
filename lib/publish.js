import { getConnectedAccount, logPost } from './db';

const GRAPH = 'https://graph.facebook.com/v21.0';

// The uploaded file's URL tells us whether it is a video (upload-video.js keeps the extension).
export const isVideoUrl = (u) => /\.(mp4|mov|m4v|webm)(\?|$)/i.test(u || '');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Shared publishing logic, used by both the immediate-post API routes and the
// scheduled-post cron. Each function throws on failure and logs to post_log either way.

export async function publishToMeta({ platform, pageId, imageUrl, caption }) {
  try {
    const account = await getConnectedAccount(platform, pageId);
    let result;
    const video = isVideoUrl(imageUrl);

    if (platform === 'facebook') {
      const r = await fetch(`${GRAPH}/${pageId}/${video ? 'videos' : 'photos'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          video
            ? { file_url: imageUrl, description: caption, access_token: account.access_token }
            : { url: imageUrl, caption, access_token: account.access_token }
        ),
      });
      result = await r.json();
      if (result.error) throw new Error(JSON.stringify(result.error));
    }

    if (platform === 'instagram') {
      // Step 1: create a media container
      const containerRes = await fetch(`${GRAPH}/${pageId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          video
            ? { media_type: 'REELS', video_url: imageUrl, caption, access_token: account.access_token }
            : { image_url: imageUrl, caption, access_token: account.access_token }
        ),
      });
      const container = await containerRes.json();
      if (container.error) throw new Error(JSON.stringify(container.error));

      // Step 2: wait until Instagram has finished processing the image.
      // Videos take much longer to process than photos, so wait up to ~2 minutes for them.
      let statusCode = 'IN_PROGRESS';
      const maxAttempts = video ? 40 : 10;
      for (let attempt = 0; attempt < maxAttempts && statusCode === 'IN_PROGRESS'; attempt++) {
        await sleep(video ? 3000 : 2000);
        const statusRes = await fetch(`${GRAPH}/${container.id}?fields=status_code&access_token=${account.access_token}`);
        const statusData = await statusRes.json();
        statusCode = statusData.status_code;
      }
      if (statusCode !== 'FINISHED') {
        throw new Error(`Instagram media never finished processing (status: ${statusCode})`);
      }

      // Step 3: publish it
      const publishRes = await fetch(`${GRAPH}/${pageId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: container.id, access_token: account.access_token }),
      });
      result = await publishRes.json();
      if (result.error) throw new Error(JSON.stringify(result.error));
    }

    await logPost({ platform, externalId: pageId, caption, imageUrl, status: 'success', response: result });
    return result;
  } catch (err) {
    await logPost({ platform, externalId: pageId, caption, imageUrl, status: 'error', response: String(err) });
    throw err;
  }
}

export async function publishToLinkedIn({ authorUrn, imageUrl, caption }) {
  try {
    const account = await getConnectedAccount('linkedin', authorUrn);
    const video = isVideoUrl(imageUrl);
    const headers = {
      Authorization: `Bearer ${account.access_token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    };

    // Step 1: register the image upload
    const registerRes = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        registerUploadRequest: {
          recipes: [video ? 'urn:li:digitalmediaRecipe:feedshare-video' : 'urn:li:digitalmediaRecipe:feedshare-image'],
          owner: authorUrn,
          serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
        },
      }),
    });
    const registerData = await registerRes.json();
    const uploadUrl = registerData.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
    const asset = registerData.value.asset;

    // Step 2: fetch the file bytes and upload them to LinkedIn
    const imageBytes = await (await fetch(imageUrl)).arrayBuffer();
    const uploadRes = await fetch(uploadUrl, {
      method: video ? 'PUT' : 'POST',
      headers: { Authorization: `Bearer ${account.access_token}`, ...(video ? { 'Content-Type': 'application/octet-stream' } : {}) },
      body: Buffer.from(imageBytes),
    });
    if (!uploadRes.ok) throw new Error(`LinkedIn upload failed (${uploadRes.status})`);

    // Videos need processing on LinkedIn's side before they can be attached to a post.
    if (video) {
      const assetId = asset.split(':').pop();
      let ready = false;
      for (let attempt = 0; attempt < 20 && !ready; attempt++) {
        await sleep(3000);
        const st = await fetch(`https://api.linkedin.com/v2/assets/${assetId}`, { headers });
        const info = await st.json().catch(() => ({}));
        const state = info?.recipes?.[0]?.status;
        if (state === 'AVAILABLE') ready = true;
        else if (state === 'PROCESSING_FAILED' || state === 'CLIENT_ERROR') throw new Error('LinkedIn could not process this video');
      }
      if (!ready) throw new Error('LinkedIn is still processing the video. Try again in a minute.');
    }

    // Step 3: create the post referencing the uploaded asset
    const postRes = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        author: authorUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: caption },
            shareMediaCategory: video ? 'VIDEO' : 'IMAGE',
            media: [{ status: 'READY', media: asset }],
          },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      }),
    });
    const result = await postRes.json();
    if (!postRes.ok) throw new Error(JSON.stringify(result));

    await logPost({ platform: 'linkedin', externalId: authorUrn, caption, imageUrl, status: 'success', response: result });
    return result;
  } catch (err) {
    await logPost({ platform: 'linkedin', externalId: authorUrn, caption, imageUrl, status: 'error', response: String(err) });
    throw err;
  }
}

export function publishTo({ platform, externalId, imageUrl, caption }) {
  return platform === 'linkedin'
    ? publishToLinkedIn({ authorUrn: externalId, imageUrl, caption })
    : publishToMeta({ platform, pageId: externalId, imageUrl, caption });
}
