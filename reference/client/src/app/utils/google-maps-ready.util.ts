export function waitForGoogleMaps(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if ((window as any).google?.maps?.importLibrary) {
        (window as any).google.maps.importLibrary('places').then(() => resolve());
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}