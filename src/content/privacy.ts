/**
 * The privacy notice. DRAFT: it describes only what this site's code actually does with
 * the contact form, and the team (or their adviser) confirms it before launch. It makes no
 * promise the code does not keep.
 */
export const PRIVACY = {
  title: 'Privacy',
  updated: 'Draft, to be confirmed by ProDevly before launch.',
  sections: [
    {
      heading: 'What we collect',
      body: 'When you send the contact form we receive your name, your email address and your message, and, if you add them, your company, the kind of project, your timing and the plan you chose. We also store the page you sent it from, any campaign tags in the link, your browser type, and a one-way scrambled form of your IP address, used only to limit spam. We never store the IP address itself.',
    },
    {
      heading: 'Why',
      body: 'To read your enquiry, reply to you by email and, if we work together, to keep a record of how the conversation started. We do not use it for advertising and we do not sell it.',
    },
    {
      heading: 'Who handles it',
      body: 'Your enquiry is stored in our own database and may also be delivered to our inbox through Web3Forms, the form service this site uses. The site has no analytics or advertising trackers.',
    },
    {
      heading: 'Cookies',
      body: 'The public site sets no cookies. Our admin panel uses a sign-in cookie for the team only.',
    },
    {
      heading: 'Your choices',
      body: 'You can ask us what we hold about you, or ask us to correct or delete it, by writing to the email address below.',
    },
  ],
} as const;
