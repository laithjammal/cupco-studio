/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The geometry and render packages ship as TypeScript source (they are
  // consumed by the browser, the Node worker and the test runner alike), so
  // Next must transpile them rather than expect prebuilt JS.
  transpilePackages: ['@cupco/geometry', '@cupco/render'],

  webpack: (config) => {
    // Those packages use the ESM-correct './foo.js' specifier to refer to
    // './foo.ts'. tsc and vitest resolve this natively; webpack does not, so
    // teach it the same mapping rather than stripping the extensions and
    // making the packages invalid ESM.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
    return config;
  },
};
export default nextConfig;
