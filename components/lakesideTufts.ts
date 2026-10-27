// Base point (bottom centre) and width on the 1600×900 stage; sorted by y so nearer tufts paint over farther ones.
export interface Tuft {
	x: number;
	y: number;
	w: number;
	shade: number;
	flip: boolean;
	delay: number;
	duration: number;
}

export const tufts: Tuft[] = [
	{ x: -9, y: 534, w: 26, shade: 0.81, flip: true, delay: -3.6, duration: 5.2 },
	{ x: 12, y: 535, w: 24, shade: 0.78, flip: true, delay: -2.5, duration: 3.2 },
	{ x: -3, y: 536, w: 26, shade: 0.77, flip: true, delay: -0.9, duration: 5.4 },
	{ x: -17, y: 536, w: 29, shade: 0.75, flip: false, delay: -3.6, duration: 5.5 },
	{ x: -156, y: 575, w: 26, shade: 0.93, flip: false, delay: -0.1, duration: 5.3 },
	{ x: -162, y: 579, w: 31, shade: 0.9, flip: true, delay: -3.1, duration: 5.5 },
	{ x: -161, y: 586, w: 30, shade: 0.93, flip: true, delay: -1.4, duration: 3.3 },
	{ x: 8, y: 588, w: 34, shade: 1.02, flip: false, delay: -4.3, duration: 3.7 },
	{ x: 850, y: 614, w: 45, shade: 0.91, flip: true, delay: -2.8, duration: 5.6 },
	{ x: 865, y: 618, w: 37, shade: 0.92, flip: true, delay: -2.8, duration: 5.5 },
	{ x: 870, y: 623, w: 52, shade: 0.79, flip: true, delay: -2.2, duration: 5.2 },
	{ x: 856, y: 628, w: 38, shade: 1.03, flip: false, delay: -4.7, duration: 3.8 },
	{ x: 398, y: 675, w: 63, shade: 1.03, flip: false, delay: -4.1, duration: 5.7 },
	{ x: 699, y: 706, w: 80, shade: 0.75, flip: true, delay: -1, duration: 3.3 },
	{ x: 671, y: 711, w: 84, shade: 0.99, flip: false, delay: -3.8, duration: 5.7 },
	{ x: -122, y: 715, w: 50, shade: 0.83, flip: false, delay: -2.1, duration: 4 },
	{ x: 706, y: 716, w: 84, shade: 0.8, flip: false, delay: -2.3, duration: 4.2 },
	{ x: 51, y: 740, w: 80, shade: 0.86, flip: true, delay: -0.6, duration: 3.4 },
	{ x: 82, y: 750, w: 87, shade: 0.98, flip: true, delay: -0.3, duration: 5.1 },
	{ x: 318, y: 762, w: 108, shade: 0.75, flip: false, delay: -1.6, duration: 4.2 },
	{ x: 253, y: 764, w: 78, shade: 0.8, flip: false, delay: -0.6, duration: 3.3 },
	{ x: 248, y: 791, w: 96, shade: 0.83, flip: true, delay: -4.4, duration: 5.5 },
	{ x: 313, y: 795, w: 68, shade: 1.04, flip: true, delay: -3.2, duration: 4.3 },
	{ x: 581, y: 886, w: 186, shade: 0.95, flip: true, delay: -0.6, duration: 4.8 },
	{ x: -26, y: 894, w: 108, shade: 1.02, flip: false, delay: -4.1, duration: 4.3 },
	{ x: 716, y: 929, w: 148, shade: 0.94, flip: false, delay: -0.6, duration: 4 },
	{ x: 534, y: 930, w: 126, shade: 0.86, flip: true, delay: -3.5, duration: 5.5 },
];
