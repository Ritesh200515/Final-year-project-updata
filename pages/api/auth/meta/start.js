// Kicks off the Meta OAuth flow. Link a button in your dashboard to GET /api/auth/meta/start
export default function handler(req, res) {
  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: process.env.META_REDIRECT_URI,
    // pages_manage_posts + pages_read_engagement: post to the Facebook Page
    // instagram_basic + instagram_content_publish: post to the linked Instagram Business account
    // business_management: needed to list Pages the user's Business Manager controls
    scope: [
      'pages_manage_posts',
      'pages_read_engagement',
      'instagram_basic',
      'instagram_content_publish',
      'business_management',
    ].join(','),
    response_type: 'code',
  });
  res.redirect(`https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`);
}
