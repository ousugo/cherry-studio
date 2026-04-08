// Public entry point for the paths module.
//
// Only PATHS (data) and PathKey (type) are re-exported. The actual
// lookup/validation logic lives in Application.getPath() so that all
// consumers go through a single access point.

export { type PathKey, PATHS } from './pathRegistry'
