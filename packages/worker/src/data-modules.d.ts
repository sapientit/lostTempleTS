// Matches the [[rules]] Data-module glob in wrangler.toml.
declare module "*.ttf" {
  const data: ArrayBuffer;
  export default data;
}
