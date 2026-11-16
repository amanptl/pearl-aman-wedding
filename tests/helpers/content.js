import fs from "node:fs";

/**
 * Content for specs that edit hotels: the live content.json with the board fixture's five hotels in place of the
 * published ones. The published site may list fewer hotels (or none with a photo), but these specs reorder hotels,
 * rename the second and third, and replace the first one's photo, so they need a stable, fuller list.
 */
export function editorContent() {
  const live = JSON.parse(fs.readFileSync("content/content.json", "utf8"));
  const board = JSON.parse(fs.readFileSync("tests/fixtures/content-board.json", "utf8"));
  return { ...live, hotels: board.hotels };
}
export const editorContentText = () => JSON.stringify(editorContent(), null, 2) + "\n";
