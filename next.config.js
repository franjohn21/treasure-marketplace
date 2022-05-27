module.exports = {
  images: {
    domains: [
      "ipfs.io",
      "storage.googleapis.com",
      "treasure-marketplace.mypinata.cloud",
      "cdn.talesofelleria.com",
    ],
  },
  async redirects() {
    return [
      {
        source: "/collection",
        destination: "/",
        permanent: true,
      },
    ];
  },
};
