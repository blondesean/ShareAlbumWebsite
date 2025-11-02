import React, { useEffect, useState } from "react";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

const REGION = process.env.REACT_APP_AWS_REGION!;
const BUCKET = process.env.REACT_APP_BUCKET_NAME!;

const s3Client = new S3Client({
    region: REGION,
    credentials: {
        accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY!,
    },
});

type Photo = {
    key: string;
    url: string;
    year: string;
    month: string;
    baseName: string;
    enhanced?: boolean;
    back?: boolean;
};

function App() {
    const [photos, setPhotos] = useState<Photo[]>([]);
    const [yearFilter, setYearFilter] = useState<string>("");
    const [monthFilter, setMonthFilter] = useState<string>("");

    useEffect(() => {
        async function fetchPhotos() {
            const command = new ListObjectsV2Command({ Bucket: BUCKET });
            const data = await s3Client.send(command);
            if (!data.Contents) return;

            const photoList: Photo[] = data.Contents
                .filter((obj) => obj.Key?.endsWith(".jpg"))
                .map((obj) => {
                    const key = obj.Key!;
                    const url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
                    const [year, month, ...rest] = key.split("_");
                    const baseName = rest.join("_").replace(/\.jpg$/, "");
                    const enhanced = key.includes("_a");
                    const back = key.includes("_b");

                    return { key, url, year, month, baseName, enhanced, back };
                });

            setPhotos(photoList);
        }

        fetchPhotos();
    }, []);

    const filteredPhotos = photos.filter(
        (p) =>
            (!yearFilter || p.year === yearFilter) &&
            (!monthFilter || p.month === monthFilter)
    );

    const years = Array.from(new Set(photos.map((p) => p.year)));
    const months = Array.from(new Set(photos.map((p) => p.month)));

    return (
        <div style={{ padding: 20 }}>
            <h1>Album Share</h1>

            <div style={{ marginBottom: 20 }}>
                <label>
                    Year:{" "}
                    <select
                        value={yearFilter}
                        onChange={(e) => setYearFilter(e.target.value)}
                    >
                        <option value="">All</option>
                        {years.map((y) => (
                            <option key={y} value={y}>
                                {y}
                            </option>
                        ))}
                    </select>
                </label>

                <label style={{ marginLeft: 20 }}>
                    Month:{" "}
                    <select
                        value={monthFilter}
                        onChange={(e) => setMonthFilter(e.target.value)}
                    >
                        <option value="">All</option>
                        {months.map((m) => (
                            <option key={m} value={m}>
                                {m}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {filteredPhotos.map((p) => (
                    <div key={p.key} style={{ textAlign: "center" }}>
                        <img
                            src={p.url}
                            alt={p.key}
                            style={{
                                width: 150,
                                height: 150,
                                objectFit: "cover",
                                border: p.enhanced
                                    ? "3px solid green"
                                    : p.back
                                        ? "3px solid blue"
                                        : undefined,
                            }}
                        />
                        <div style={{ fontSize: 12 }}>
                            {p.baseName} {p.enhanced ? "(enhanced)" : p.back ? "(back)" : ""}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default App;
