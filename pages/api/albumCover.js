/*TO DO:
- Set up all the required tokens and env variables.
- Set up the User-Agent for fetchMBID
- Can use fetchDiscogsLocal but need to run it locally and have a song name. So, find maybe if it's possible to use album title rather than song.
- Look at maybe having some sort of fuzzy search in the API request instead of using exact match. Find some other API routes maybe that do not look for exact match.
*/


// URL for the library-metadata-lookup Python service (Discogs)
// uses localhost:8000 locally, or whatever LML_URL is set to in production
const LML_URL = process.env.LML_URL || 'http://localhost:8000';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.wxdu.art';

const DISCOGS_TOKEN = process.env.DISCOGS_TOKEN || null;

// tests all other functions and returns the cover
export async function getAlbumCover(artist, song, album){
    if (!artist || !album) return null;

  // starts by using local discogs through Jake's metadata, then api.wxdu.art API, then final Discogs own API
  const cover =
    await fetchDiscogsLocal(artist, song, album) ||
    await fetchMongodb(artist, song, album);

  return cover;
}

// Handles request made to the API
export default async function handler(req, res) {
  const { artist, song, album } = req.query;

  if (!artist || !album) {
    return res.status(400).json({
      error: "artist and album are required",
    });
  }

  try {
    const coverUrl = await getAlbumCover(
      artist,
      song || null,
      album
    );

    return res.status(200).json(coverUrl);
  } catch (err) {
    console.error("[albumCover API]", err);

    return res.status(500).json({
      error: "Failed to fetch album cover",
      coverUrl: null,
    });
  }
}

// given an artist, song and album name, searches Discogs and returns an album cover URL
export async function fetchDiscogsLocal(artist, song, album) {

  if (!song) return null

  // This is Temporary
  if (!song) return null

  try {
    // step 1: search Discogs for releases that contain this track
    // encodeURIComponent converts spaces/special chars to URL-safe format
    // e.g. "200 Years" becomes "200%20Years"
    const trackRes = await fetch(
      `${LML_URL}/api/v1/discogs/track-releases?artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(song)}`
    );
    const trackData = await trackRes.json();

    // if no releases found on Discogs, return null (no art)
    if (!trackData.releases?.length) return null;

    // take the first matching release's ID
    const releaseId = trackData.releases[0].release_id;

    // step 2: fetch full release details using that ID, which includes artwork_url
    const releaseRes = await fetch(`${LML_URL}/api/v1/discogs/release/${releaseId}`);
    const releaseData = await releaseRes.json();

    return releaseData.artwork_url || null;
  } catch (e) {
    // if anything fails, return null so the widget still works without art
    console.error("[fetchDiscogsLocal]", e);
    return null;
  }
}

// calling the wxdu.art release API to get album covers from Mongodb
export async function fetchMongoDB(artist, song, album){
    let url;

    try{
        const response = await fetch(`${API_URL}/api/releases?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(album)}`)
        const data = await response.json()
        url = data?.[0]?.cover_url
    }catch(e){
        console.error("[fetchMongoDB]", e);
        return null;
    }

    if (!url) return null
    return `${API_URL}/${url}`
}

//using Discogs API direcly instead of Jake's metadata.
// error 429 may occur if two many requests are sent. so use this rarely.
export async function fetchDiscogsAPI(artist, song, album){
  if (!DISCOGS_TOKEN){
    return null
  }
  // setting up URL search parameters
  let params = new URLSearchParams({
    token: DISCOGS_TOKEN
  });

  // adding to the parameters all that we can find.
  if (artist) params.append("artist", artist);
  if (album) params.append("album", album);
  // if (song) params.append("track", song);

  // querrying Discogs API
  const res = await fetch(
    `https://api.discogs.com/database/search?${params}`
  );

  if (!res.ok) {
    throw new Error(`Discogs API error: ${res.status}`);
  }

  const data = await res.json();

  // if the first array element does not contain cover image, goes to the next elements until it finds one with cover_image
  // if none is find, returns null
  return (
    data.results?.[0]?.cover_image ??
    data.results?.find(item => item?.cover_image)?.cover_image ??
    null
  );
}

// using MBID to get album cover
// works but requires User-Agent through the server
export async function fetchMBID(artist, song, album){

  const query = `artist:${artist} AND release:"${album}"`;

  // step 1: fetching musicbrainz to get release information
  const res = await fetch(`
      https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json
    `)
  
  // Fetch receives a 403 Forbidden error.
  /*
  console.log(res.status);
  const body = await res.text();
  console.log(body);
  
  */

  if (!res.ok) {
    throw new Error(`MBID API error: ${res.status}`);
  }

  const data = await res.json();

  // getting mbid from the release information
  const mbid = data?.releases?.[0]?.id;

  if (!mbid){
    return null;
  }
  
  // Step 2: getting from coverartarchive the info for the album cover 
  const coverData = await fetch(
    `https://coverartarchive.org/release/${mbid}`,
    {
      headers: {
        "User-Agent": "MyMusicApp/1.0 (me@example.com)"
      }
    }
  )
    .then(r => r.ok ? r.json() : null)
    .catch(() => null)

    // look for the front image first, if none then just take the first image, if none return null
    return (
      coverData?.images?.find(img => img.front)?.image ??
      coverData?.images?.[0]?.image ??
      null
    );
}

export async function fetchITunes(artist, song, album) {
  if (!artist || !album) return null;

  try {
    const term = `${artist} ${album}`;
    const params = new URLSearchParams({
      term,
      media: "music",
      entity: "album",
      limit: "5",
    });

    const res = await fetch(`https://itunes.apple.com/search?${params}`);
    if (!res.ok) return null;

    const data = await res.json();

    const match =
      data.results?.find(item =>
        item.collectionName?.toLowerCase() === album.toLowerCase()
      ) || data.results?.[0];

    return match?.artworkUrl100
      ?.replace("100x100bb", "600x600bb")
      ?.replace("100x100", "600x600") || null;
  } catch (e) {
    console.error("[fetchITunes]", e);
    return null;
  }
}


let spotifyTokenCache = null;

async function getSpotifyToken() {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) return null;

  if (
    spotifyTokenCache &&
    Date.now() < spotifyTokenCache.expiresAt
  ) {
    return spotifyTokenCache.accessToken;
  }

  const basic = Buffer.from(
    `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) return null;

  const data = await res.json();

  spotifyTokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  return spotifyTokenCache.accessToken;
}

export async function fetchSpotify(artist, song, album) {
  if (!artist || !album) return null;

  try {
    const token = await getSpotifyToken();
    if (!token) return null;

    const query = `album:${album} artist:${artist}`;
    const params = new URLSearchParams({
      q: query,
      type: "album",
      limit: "5",
    });

    const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) return null;

    const data = await res.json();

    const match =
      data.albums?.items?.find(item =>
        item.name?.toLowerCase() === album.toLowerCase()
      ) || data.albums?.items?.[0];

    return match?.images?.[0]?.url || null;
  } catch (e) {
    console.error("[fetchSpotify]", e);
    return null;
  }
}