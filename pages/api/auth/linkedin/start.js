export default function handler(req, res) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.LINKEDIN_CLIENT_ID,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI,
    // w_member_social lets a person post as themself.
    // Posting as the iBase Company Page needs w_organization_social, which LinkedIn
    // only grants after approving your app for the Community Management API — see README.
    scope: 'w_member_social',
  });
  res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`);
}
