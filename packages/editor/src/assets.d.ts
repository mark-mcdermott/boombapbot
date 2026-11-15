// Asset imports resolved by the bundler to a URL.
declare module '*.svg?url' {
  const url: string;
  export default url;
}
