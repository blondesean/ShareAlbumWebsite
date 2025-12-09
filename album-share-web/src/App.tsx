import { useEffect, useState } from "react";
import { Amplify } from "aws-amplify";
import { Authenticator } from "@aws-amplify/ui-react";
import { fetchAuthSession } from "aws-amplify/auth";
import "@aws-amplify/ui-react/styles.css";

// Configure Amplify with your Cognito settings
Amplify.configure({
    Auth: {
        Cognito: {
            userPoolId: "us-west-2_wWKJ8mrfJ",
            userPoolClientId: "4oe6jag3iv44j21ml27hh55sru",
            loginWith: {
                email: true,
            },
        },
    },
});

interface Photo {
    key: string;
    url: string;
    isFavorite?: boolean;
}

function PhotoApp({ signOut }: { signOut?: () => void }) {
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; photoKey: string } | null>(null);

    useEffect(() => {
        async function fetchPhotos() {
            try {
                console.log("API URL:", import.meta.env.VITE_API_URL);

                // Get Cognito ID token
                const session = await fetchAuthSession();
                const idToken = session.tokens?.idToken?.toString();

                if (!idToken) {
                    throw new Error("No authentication token available");
                }

                const response = await fetch(import.meta.env.VITE_API_URL, {
                    headers: {
                        Authorization: `Bearer ${idToken}`,
                    },
                });

                if (!response.ok) throw new Error("Failed to fetch photos");
                const data = await response.json();
                
                // Filter to only show photos containing "_a.jpg"
                const filteredPhotos = data.filter((photo: Photo) => photo.key.includes("_a.jpg"));
                
                // Mark favorites and sort (favorites first)
                const photosWithFavorites = filteredPhotos.map((photo: Photo) => ({
                    ...photo,
                    isFavorite: photo.isFavorite || false,
                }));
                
                // Sort: favorites first, then by key
                photosWithFavorites.sort((a: Photo, b: Photo) => {
                    if (a.isFavorite && !b.isFavorite) return -1;
                    if (!a.isFavorite && b.isFavorite) return 1;
                    return 0;
                });
                
                setPhotos(photosWithFavorites);
                
                // Build favorites set
                const favSet = new Set<string>(photosWithFavorites.filter((p: Photo) => p.isFavorite).map((p: Photo) => p.key));
                setFavorites(favSet);
            } catch (err: any) {
                console.error(err);
                setError(err.message);
            }
        }
        fetchPhotos();
    }, []);

    const toggleFavorite = async (photoKey: string) => {
        try {
            const session = await fetchAuthSession();
            const idToken = session.tokens?.idToken?.toString();

            if (!idToken) {
                throw new Error("No authentication token available");
            }

            const isFavorite = favorites.has(photoKey);
            const method = isFavorite ? "DELETE" : "POST";
            const apiUrl = import.meta.env.VITE_API_URL.replace("/photos", "/favorites");

            const response = await fetch(apiUrl, {
                method,
                headers: {
                    Authorization: `Bearer ${idToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ photoKey }),
            });

            if (!response.ok) throw new Error("Failed to update favorite");

            // Update local state (just toggle the border, don't re-sort)
            const newFavorites = new Set(favorites);
            if (isFavorite) {
                newFavorites.delete(photoKey);
            } else {
                newFavorites.add(photoKey);
            }
            setFavorites(newFavorites);
        } catch (err: any) {
            console.error(err);
            setError(err.message);
        }
    };

    return (
        <div
            style={{ padding: "1rem" }}
            onClick={() => setContextMenu(null)}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h1>Family Album</h1>
                <button onClick={signOut}>Sign Out</button>
            </div>
            {error && <p style={{ color: "red" }}>Error: {error}</p>}
            {!error && !photos.length && <p>Loading photos...</p>}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: "10px",
                }}
            >
                {photos.map((photo) => (
                    <div
                        key={photo.key}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            setContextMenu({ x: e.clientX, y: e.clientY, photoKey: photo.key });
                        }}
                        style={{ cursor: "pointer" }}
                    >
                        <img
                            src={photo.url}
                            alt={photo.key}
                            style={{
                                width: "100%",
                                borderRadius: "8px",
                                border: favorites.has(photo.key) ? "4px solid gold" : "none",
                            }}
                        />
                        <p style={{ fontSize: "0.9rem" }}>{photo.key}</p>
                    </div>
                ))}
            </div>

            {contextMenu && (
                <div
                    style={{
                        position: "fixed",
                        top: contextMenu.y,
                        left: contextMenu.x,
                        backgroundColor: "white",
                        border: "1px solid #ccc",
                        borderRadius: "4px",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                        padding: "4px 0",
                        zIndex: 1000,
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={() => {
                            toggleFavorite(contextMenu.photoKey);
                            setContextMenu(null);
                        }}
                        style={{
                            display: "block",
                            width: "100%",
                            padding: "8px 16px",
                            border: "none",
                            background: "none",
                            textAlign: "left",
                            cursor: "pointer",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f0f0f0")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                        {favorites.has(contextMenu.photoKey) ? "Remove Favorite" : "Make Favorite"}
                    </button>
                </div>
            )}
        </div>
    );
}

export default function App() {
    return (
        <Authenticator>
            {({ signOut }) => <PhotoApp signOut={signOut} />}
        </Authenticator>
    );
}
