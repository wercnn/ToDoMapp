/** @type {import('next').NextConfig} */
const nextConfig = {
  // The API is the only consumer of the domain tables (Supabase Data API is
  // disabled). `pg` is a native-ish dependency that must stay external to the
  // server bundle so the pooled connection works in the serverless runtime.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
