import { createClient } from '@supabase/supabase-js';

// Server-side only — uses the service role key, never expose this client to the browser.
export const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function saveConnectedAccount({ platform, displayName, externalId, accessToken, expiresAt }) {
  const { encrypt } = await import('./crypto');
  const { error } = await db.from('connected_accounts').upsert(
    {
      platform,
      display_name: displayName,
      external_id: externalId,
      encrypted_access_token: encrypt(accessToken),
      token_expires_at: expiresAt || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'platform,external_id' }
  );
  if (error) throw error;
}

export async function getConnectedAccount(platform, externalId) {
  const { decrypt } = await import('./crypto');
  const { data, error } = await db
    .from('connected_accounts')
    .select('*')
    .eq('platform', platform)
    .eq('external_id', externalId)
    .single();
  if (error) throw error;
  return { ...data, access_token: decrypt(data.encrypted_access_token) };
}

export async function listConnectedAccounts() {
  const { data, error } = await db.from('connected_accounts').select('platform, display_name, external_id, token_expires_at, created_at');
  if (error) throw error;
  return data;
}

export async function deleteConnectedAccount(platform, externalId) {
  const { error } = await db
    .from('connected_accounts')
    .delete()
    .eq('platform', platform)
    .eq('external_id', externalId);
  if (error) throw error;
}

export async function logPost({ platform, externalId, caption, imageUrl, status, response }) {
  await db.from('post_log').insert({
    platform, external_id: externalId, caption, image_url: imageUrl, status, response,
  });
}

export async function listPostHistory(limit = 200) {
  const { data, error } = await db
    .from('post_log')
    .select('id, platform, external_id, caption, image_url, status, response, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Delete history rows by id (only touches post_log; never the posts already published on social media).
export async function deletePostHistory(ids) {
  const { data, error } = await db.from('post_log').delete().in('id', ids).select('id');
  if (error) throw error;
  return (data || []).length;
}

// --- Real user accounts (email + hashed password), added for login/signup ---

export async function createUser(email, passwordHash) {
  const { data, error } = await db
    .from('app_users')
    .insert({ email: email.toLowerCase().trim(), password_hash: passwordHash })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getUserByEmail(email) {
  const { data, error } = await db
    .from('app_users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();
  if (error) throw error;
  return data;
}


// --- Scheduled posts ---

export async function createScheduledPosts(rows) {
  const { data, error } = await db.from('scheduled_posts').insert(rows).select();
  if (error) throw error;
  return data;
}

export async function listScheduledPosts(limit = 100) {
  const { data, error } = await db
    .from('scheduled_posts')
    .select('id, platform, external_id, account_name, caption, image_url, scheduled_for, status, error, posted_at')
    .order('scheduled_for', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function cancelScheduledPost(id) {
  const { data, error } = await db
    .from('scheduled_posts')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select();
  if (error) throw error;
  return data && data.length > 0;
}

// Atomically claim due posts: each row only flips pending -> processing once, so two
// overlapping cron runs can never publish the same post twice.
export async function claimDuePosts(limit = 5) {
  const nowIso = new Date().toISOString();

  // Recover posts stuck in "processing" (e.g. function timed out mid-publish) for >15 min.
  // They're marked failed rather than retried, since the post may have actually gone out.
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  await db
    .from('scheduled_posts')
    .update({ status: 'failed', error: 'Timed out while publishing — check the platform before retrying', updated_at: nowIso })
    .eq('status', 'processing')
    .lt('updated_at', staleBefore);

  const { data: due, error } = await db
    .from('scheduled_posts')
    .select('id')
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(limit);
  if (error) throw error;

  const claimed = [];
  for (const { id } of due || []) {
    const { data, error: claimErr } = await db
      .from('scheduled_posts')
      .update({ status: 'processing', attempts: 1, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending')
      .select();
    if (!claimErr && data && data.length) claimed.push(data[0]);
  }
  return claimed;
}

export async function finishScheduledPost(id, { ok, error }) {
  await db
    .from('scheduled_posts')
    .update({
      status: ok ? 'posted' : 'failed',
      error: ok ? null : String(error).slice(0, 1000),
      posted_at: ok ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
}
