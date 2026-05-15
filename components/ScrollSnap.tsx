'use client';

import { useEffect } from 'react';

const SELECTORS = [
  'header',
  '#produto',
  '#tese',
  '#marco-regulatorio',
  '#compliance',
  '#equipe',
  '#lead-capture',
  'footer',
];

const NAV_HEIGHT = 80;

export default function ScrollSnap() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let isSnapping = false;
    let lastScrollY = window.scrollY;
    let scrollDir = 0;

    const getSnapPoints = () => {
      const sections = SELECTORS
        .map(s => document.querySelector(s))
        .filter(Boolean) as Element[];

      return sections.map((section, i) => {
        const offset = i === 0 ? 0 : NAV_HEIGHT;
        return section.getBoundingClientRect().top + window.scrollY - offset;
      });
    };

    const snap = () => {
      if (isSnapping) return;

      const scrollY = window.scrollY;
      const snapPoints = getSnapPoints();

      // Find the two snap points we're between
      let lowerIdx = 0;
      for (let i = 0; i < snapPoints.length - 1; i++) {
        if (scrollY >= snapPoints[i] - 2) lowerIdx = i;
      }
      const upperIdx = Math.min(lowerIdx + 1, snapPoints.length - 1);

      const lowerY = snapPoints[lowerIdx];
      const upperY = snapPoints[upperIdx];

      // Decide target based on scroll direction and how far into the section we are
      let targetY: number;
      if (scrollDir >= 0) {
        // Scrolling down: snap forward if past 30% into the section, else stay
        const trigger = lowerY + (upperY - lowerY) * 0.3;
        targetY = scrollY >= trigger ? upperY : lowerY;
      } else {
        // Scrolling up: snap back if within 70% of section top, else stay
        const trigger = lowerY + (upperY - lowerY) * 0.7;
        targetY = scrollY <= trigger ? lowerY : upperY;
      }

      if (Math.abs(targetY - scrollY) > 2) {
        isSnapping = true;
        window.scrollTo({ top: targetY, behavior: 'smooth' });
        setTimeout(() => { isSnapping = false; }, 800);
      }
    };

    const onScroll = () => {
      const current = window.scrollY;
      scrollDir = current >= lastScrollY ? 1 : -1;
      lastScrollY = current;
      clearTimeout(timer);
      timer = setTimeout(snap, 180);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      clearTimeout(timer);
    };
  }, []);

  return null;
}
