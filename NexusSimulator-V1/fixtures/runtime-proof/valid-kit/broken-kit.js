export function createKit() {
  return {
    id: "broken",
    requires: [],
    provides: [],
    metadata: {},
    install() {
      window.document.querySelector("canvas");
    }
  };
}
