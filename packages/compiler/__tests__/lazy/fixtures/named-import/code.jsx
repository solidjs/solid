import { lazy } from 'solid-js';

const Home = lazy(() => import('./Home'));

// Options bag in second position: the placeholder pads into the third slot.
const AboutPage = lazy(() => import('./Pages'), { export: 'AboutPage' });

export function routes() {
  // Module-scope binding used from a nested scope still matches.
  const About = lazy(() => import('./About'));
  return [Home, About];
}
