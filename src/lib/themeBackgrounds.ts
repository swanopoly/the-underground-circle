// Static require() map for theme background PNGs.
// Metro bundler requires literal strings in require() calls.

import { ImageSourcePropType } from 'react-native';
import { EnvironmentType } from './officeConfig';

export const THEME_BACKGROUNDS: Record<EnvironmentType, ImageSourcePropType | null> = {
  ship: require('../../assets/themes/ship-bg.png'),
  castle: require('../../assets/themes/castle-bg.png'),
  station: require('../../assets/themes/station-bg.png'),
  submarine: require('../../assets/themes/submarine-bg.png'),
  mansion: require('../../assets/themes/mansion-bg.png'),
  lair: require('../../assets/themes/lair-bg.png'),
  cabin: require('../../assets/themes/cabin-bg.png'),
  office: require('../../assets/themes/office-bg.png'),
  temple: require('../../assets/themes/temple-bg.png'),
  garden: require('../../assets/themes/garden-bg.png'),
  cyber: require('../../assets/themes/cyber-bg.png'),
  arctic: require('../../assets/themes/arctic-bg.png'),
  cathedral: null,  // Rendered procedurally — no PNG sprite
};
