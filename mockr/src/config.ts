// Rename the app in one place.
export const APP_NAME = 'R';
export const TAGLINE = 'What\'s happening in Patchwork TFT';

export const POST_MAX = 280;
export const POST_WARN = 260;

export const postPath = (id: string) => `/post/${id}`;
export const userPath = (username: string) => `/u/${username}`;
export const searchPath = (q: string) => `/search?q=${encodeURIComponent(q)}`;
