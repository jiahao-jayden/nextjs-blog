import type { CSSProperties } from "react";
import Image from "@/components/Image";
import LakeWater from "@/components/LakeWater";
import LakesideLoader from "@/components/LakesideLoader";
import { type Tuft, tufts } from "@/components/lakesideTufts";
import siteMetadata from "@/data/siteMetadata";
import styles from "./LakesideHero.module.css";

const STAGE_W = 1600;
const STAGE_H = 900;
const SRC = "/static/images/home/lakeside";
const BASE = process.env.BASE_PATH || "";

type Motion = "drift" | "breathe";

interface Layer {
	id: string;
	asset: string;
	x: number;
	y: number;
	w: number;
	h: number;
	motion?: Motion;
	amp?: number;
	duration?: number;
}

// Coordinates follow the Lakeside Studio default scene: centre point and size on a 1600×900 stage,
// which `.scene` maps onto the original painting inside the wider background.
const layers: Layer[] = [
	{ id: "cloud-left", asset: "cloud-left", x: 320, y: 230, w: 480, h: 95, motion: "drift", amp: 24, duration: 12 },
	{ id: "cloud-center", asset: "cloud-center", x: 820, y: 200, w: 460, h: 205, motion: "drift", amp: 38, duration: 12 },
	{ id: "cloud-right", asset: "cloud-right", x: 1370, y: 190, w: 430, h: 201, motion: "drift", amp: 30, duration: 12 },
	{ id: "person", asset: "person", x: 610, y: 615, w: 390, h: 133, motion: "breathe", amp: 1.3, duration: 6 },
];

const GRASS_ASPECT = 374 / 400;

function tuftStyle({ x, y, w, shade, flip, delay, duration }: Tuft): CSSProperties {
	const h = w * GRASS_ASPECT;
	return {
		left: `${((x - w / 2) / STAGE_W) * 100}%`,
		top: `${((y - h) / STAGE_H) * 100}%`,
		width: `${(w / STAGE_W) * 100}%`,
		height: `${(h / STAGE_H) * 100}%`,
		"--amp": `${2 + w / 80}deg`,
		"--flip": flip ? -1 : 1,
		"--shade": shade,
		"--delay": `${delay}s`,
		"--duration": `${duration / 2}s`,
	} as CSSProperties;
}

function layerStyle({ x, y, w, h, amp = 0, duration = 5, motion }: Layer): CSSProperties {
	return {
		left: `${((x - w / 2) / STAGE_W) * 100}%`,
		top: `${((y - h / 2) / STAGE_H) * 100}%`,
		width: `${(w / STAGE_W) * 100}%`,
		height: `${(h / STAGE_H) * 100}%`,
		"--amp": motion === "drift" ? `${(amp / w) * 100}%` : 1 + amp / 100,
		"--duration": `${duration / 2}s`,
	} as CSSProperties;
}

export default function LakesideHero() {
	return (
		<section className={styles.hero} aria-label={siteMetadata.description}>
			<div className={styles.stage}>
				<Image
					src={`${SRC}/background-wide.webp`}
					alt=""
					fill
					preload
					unoptimized
					className={styles.background}
				/>
				<LakeWater className={styles.canvas} />
				<div className={styles.scene}>
					<video
						className={styles.roadVideo}
						style={{ maskImage: `url(${BASE}${SRC}/road-video-mask.webp)` }}
						autoPlay
						muted
						loop
						playsInline
						preload="auto"
						aria-hidden="true"
					>
						<source src={`${BASE}${SRC}/road.webm`} type="video/webm" />
						<source src={`${BASE}${SRC}/road.mp4`} type="video/mp4" />
					</video>
					{layers.map((layer) => (
						<div
							key={layer.id}
							className={`${styles.layer} ${layer.motion ? styles[layer.motion] : ""}`}
							style={layerStyle(layer)}
						>
							<Image src={`${SRC}/${layer.asset}.webp`} alt="" fill preload sizes="30vw" />
						</div>
					))}
					<div className={styles.panda} style={{ maskImage: `url(${BASE}${SRC}/panda-video-mask.webp)` }}>
						<Image src={`${SRC}/panda-still.webp`} alt="" fill preload sizes="40vw" />
						<video autoPlay muted loop playsInline preload="auto" aria-hidden="true">
							<source src={`${BASE}${SRC}/panda.webm`} type="video/webm" />
							<source src={`${BASE}${SRC}/panda.mp4`} type="video/mp4" />
						</video>
					</div>
					{tufts.map((tuft) => (
						<div key={`${tuft.x},${tuft.y}`} className={styles.tuft} style={tuftStyle(tuft)}>
							<Image src={`${SRC}/grass.webp`} alt="" fill preload sizes="12vw" className={styles.blade} />
						</div>
					))}
				</div>
			</div>
			<h1 className="sr-only">{siteMetadata.description}</h1>
			<LakesideLoader />
		</section>
	);
}
