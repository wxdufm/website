import connectToMongoDB from "@/lib/db/mongodb.js"
import { getAlbumCover } from "./albumCover"

/*TODO:
- Change the mongodb connection as required
- Run the code across all the documents in releases. Find as much album covers as possible
- Run the code on a schedule like every night etc.
- Have a log summary of results found when running the code automatically
- For album covers not found at previous attempts, try them again
    - add if cover_url found, then remove cover_lookup_last_attempt and cover_lookup_attempts
- Update search criterias for eligible releases according to your needs. For example:
    - cover_lookup_last_attempt can be more specific than just the start of today.
    - having cover_lookup_attempts to maybe at most 3 etc.
- look at the different reasons why certain album covers aren't found and make solutions for them. For example:
    - Common reasons include: spelling of the album title/artist in the MongoDB is different from that on other sources such as Discogs, iTunes etc
*/

// today's date
const startOfToday = new Date();
startOfToday.setHours(0, 0, 0, 0);

// function to update album covers in the MongoDB by creating a cover_url field in the documents in the collection "releases" 
async function updateAlbumCover(){

    // connecting to the database
    const { db } = await connectToMongoDB()

    // getting releases where album cover is null and the last attempt was not today. Limit to 10 to prevent excess queries on the different APIs

    const releases = await db.collection("releases")
                    .find({
                        cover_url: null, artist: { $ne: "!!!" }, title: { $ne: "!!!" },
                        $or: [
                            { cover_lookup_last_attempt: { $exists: false } },
                            { cover_lookup_last_attempt: { $lt: startOfToday } }
                        ]
                    })
                    .limit(10)
                    .project({_id: 1, artist: 1, title: 1})
                    .toArray();
    
    // stores the result for this round of update attempts
    const results = [{"checked": 0, "updated": 0, "notFound": 0, "errors": 0}]
    
    for (const release of releases){
        results[0].checked++;
        try{
            // getting cover url using the different APIs
            const cover_url = await getAlbumCover(release.artist, null, release.title);

            // if not found, push not found message, update database and skip this iteration
            if (!cover_url){
                results[0].notFound++;
                results.push({
                    artist: release.artist,
                    title: release.title,
                    updated: false,
                    reason: "No cover found"
                });

                // incrementing the number of attempts made, and updating the last attempt date
                await db.collection("releases").updateOne(
                    {_id: release._id},
                    {
                        $set: {
                        cover_lookup_last_attempt: new Date(),
                        },
                        $inc: {cover_lookup_attempts: 1}
                    }
                )
                continue
            }

            // updaating the document with the found URL.
            await db.collection("releases").updateOne(
                {_id: release._id},
                {$set: {
                    cover_url,
                    cover_url_source: "auto",
                    cover_url_updated_at: new Date()
                }}
            )

            // pushing successful update message
            results[0].updated++;
            results.push({
                artist: release.artist,
                title: release.title,
                updated: true,
                cover_url
            });

        }catch(err){
            console.error(
                `[ updateAlbumCover ] Failed for ${release.artist} - ${release.title}:`,
                err.message
            )

            results[0].errors++;
            results.push({
                    artist: release.artist,
                    title: release.title,
                    updated: false,
                    reason: err.message
                });
        }
        
        continue;
            
    }
    
    return results;
            

}


// API handler function to see the update process
export default async function handler(req, res) {
    try{
        const results = await updateAlbumCover();
        return res.status(200).json(results)
    }catch(error){
        console.error("[updateAlbumCover API] threw error: ", error);
        return res.status(500).json({ error: error.message });
    }
}