export {};

declare global {
  interface Window {
    google?: typeof google;
    __michikusaMapsPromise?: Promise<typeof google>;
  }
}
