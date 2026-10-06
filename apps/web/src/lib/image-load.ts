/**
 * Waiting for an image to be usable.
 *
 * NOT `img.decode()`. Chrome can hold that promise until the page next paints
 * a frame - which a background tab, or a hidden pane, does not do - so a
 * project opened while the window was not in front never finished opening:
 * it sat on a picture that had long since loaded. The `load` event is fired
 * by the network and parser, not by painting, and a loaded image can always
 * be drawn: the browser decodes it on demand if it has not yet.
 */
export function whenLoaded(img: HTMLImageElement): Promise<void> {
  // An image with no source yet also reports itself complete, so the fast
  // path is only for one that has a source and has finished with it.
  if (img.complete && img.getAttribute('src')) {
    return img.naturalWidth > 0
      ? Promise.resolve()
      : Promise.reject(new Error('the image could not be decoded'));
  }
  return new Promise((resolve, reject) => {
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => reject(new Error('the image could not be decoded')), { once: true });
  });
}
