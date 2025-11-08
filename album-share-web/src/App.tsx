import { useEffect, useState } from "react";
import { signedFetch } from "./utils/signedFetch"; 

interface Photo {
    key: string;
    url: string;
}

export default function App() {
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchPhotos() {
            try {
                console.log("API URL:", import.meta.env.VITE_API_URL);
                

                const response = await signedFetch(
                    import.meta.env.VITE_API_URL
                );
                if (!response.ok) throw new Error("Failed to fetch photos");
                const data = await response.json();
                setPhotos(data);
            } catch (err: any) {
                console.error(err);
                setError(err.message);
            }
        }
        fetchPhotos();
    }, []);

    if (error) return <p>Error: {error}</p>;
    if (!photos.length) return <p>Loading photos...</p>;

    return (
        <div style={{ padding: "1rem" }}>
            <h1>Family Album</h1>
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: "10px",
                }}
            >
                {photos.map((photo) => (
                    <div key={photo.key}>
                        <img
                            src={photo.url}
                            alt={photo.key}
                            style={{ width: "100%", borderRadius: "8px" }}
                        />
                        <p style={{ fontSize: "0.9rem" }}>{photo.key}</p>
                    </div>
                ))}
            </div>
        </div>
    );
}
