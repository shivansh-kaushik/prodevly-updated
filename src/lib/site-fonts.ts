import { Hubot_Sans, Martian_Mono, Mona_Sans } from 'next/font/google';

/**
 * The Keycap Colorway faces, as next/font CSS variables: Hubot Sans pushed wide for
 * display, Mona Sans for text, Martian Mono for keys and legends. Set on `.pd-site` by the
 * public layout and by the 404 page (which renders outside it).
 */
const hubot = Hubot_Sans({ subsets: ['latin'], axes: ['wdth'], variable: '--font-hubot', display: 'swap' });
const mona = Mona_Sans({ subsets: ['latin'], axes: ['wdth'], variable: '--font-mona', display: 'swap' });
const martian = Martian_Mono({ subsets: ['latin'], variable: '--font-martian', display: 'swap' });

export const siteFontClasses = `${hubot.variable} ${mona.variable} ${martian.variable}`;
