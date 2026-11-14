import { saveConnectedAccount } from '../../../../lib/db';

export default async function handler(req, res) {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`LinkedIn login failed: ${error}`);
  if (!code) return res.status(400).send('Missing code');

  try {
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.LINKEDIN_REDIRECT_URI,
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET,
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(JSON.stringify(tokenData));

    // Fetch the person's URN so we know who we're posting as
    const meRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const me = await meRes.json();

    await saveConnectedAccount({
      platform: 'linkedin',
      displayName: me.name || 'LinkedIn account',
      externalId: `urn:li:person:${me.sub}`,
      accessToken: tokenData.access_token,
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
    });

    res.redirect('/?connected=linkedin');
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong connecting LinkedIn. Check server logs.');
  }
}
