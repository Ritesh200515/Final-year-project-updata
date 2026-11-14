import { saveConnectedAccount } from '../../../../lib/db';

const GRAPH = 'https://graph.facebook.com/v21.0';

export default async function handler(req, res) {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Meta login failed: ${error}`);
  if (!code) return res.status(400).send('Missing code');

  try {
    // 1. Exchange the code for a short-lived user access token
    const tokenRes = await fetch(
      `${GRAPH}/oauth/access_token?` +
        new URLSearchParams({
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          redirect_uri: process.env.META_REDIRECT_URI,
          code,
        })
    );
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(JSON.stringify(tokenData.error));

    // 2. Exchange for a long-lived user token (~60 days)
    const longLivedRes = await fetch(
      `${GRAPH}/oauth/access_token?` +
        new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          fb_exchange_token: tokenData.access_token,
        })
    );
    const longLived = await longLivedRes.json();
    const userToken = longLived.access_token;

    // 3. List the Pages this user manages — Page access tokens don't expire
    //    as long as the user token stays valid.
    const pagesRes = await fetch(`${GRAPH}/me/accounts?access_token=${userToken}`);
    const pagesData = await pagesRes.json();
    if (!pagesData.data || pagesData.data.length === 0) {
      return res.status(400).send('No Facebook Pages found for this account. iBase needs to be an admin of the Page.');
    }

    // Connect every Page this Facebook user manages, not just the first one —
    // previously this only ever saved pagesData.data[0], so if the account
    // managed more than one Page, only whichever Page the Graph API happened
    // to list first ever got connected.
    for (const page of pagesData.data) {
      await saveConnectedAccount({
        platform: 'facebook',
        displayName: page.name,
        externalId: page.id,
        accessToken: page.access_token, // Page access token, used for posting
        expiresAt: null,
      });

      // Check if this Page has a linked Instagram Business account
      const igRes = await fetch(`${GRAPH}/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`);
      const igData = await igRes.json();
      if (igData.instagram_business_account?.id) {
        await saveConnectedAccount({
          platform: 'instagram',
          displayName: `${page.name} (Instagram)`,
          externalId: igData.instagram_business_account.id,
          accessToken: page.access_token, // IG publishing uses the Page token too
          expiresAt: null,
        });
      }
    }

    res.redirect('/?connected=meta');
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong connecting Meta. Check server logs.');
  }
}
