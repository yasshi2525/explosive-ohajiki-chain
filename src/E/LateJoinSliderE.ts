export interface LateJoinSliderEParameterObject extends g.EParameterObject {
	/** ラベル画像 (「2-1以降の途中参加」)。 */
	labelImageAsset: g.ImageAsset;

	/** ON 状態のトラック画像。 */
	trackOnImageAsset: g.ImageAsset;

	/** OFF 状態のトラック画像。 */
	trackOffImageAsset: g.ImageAsset;

	/** つまみ画像。 */
	knobImageAsset: g.ImageAsset;

	/** 初期値。真の時 ON。 */
	value: boolean;

	/** 真の時、ドラッグとタップで切り替えられる。偽の時は表示のみ。 */
	interactive: boolean;
}

/** ラベルとトラックの間の余白。 */
const GAP = 28;

/** トラックの端とつまみの間の余白。 */
const KNOB_MARGIN = 4;

/** つまみの移動アニメーションのフレーム数。 */
const KNOB_ANIM_FRAMES = 6;

/** タップとみなすドラッグ量の上限 (px)。 */
const TAP_THRESHOLD = 8;

/**
 * 「2-1以降の途中参加」の許可・不許可を切り替えるスライダー。
 *
 * ラベルとスライダーは縦中央で揃える。
 * つまみをドラッグするか、トラックをタップすると値が切り替わる。
 * 値の変更は onValueChange で通知される。表示のみの用途では
 * interactive を偽にし、setValue() で外から値を反映する。
 */
export class LateJoinSliderE extends g.E {
	/** 値が切り替わった時に発火する。引数は新しい値。 */
	onValueChange: g.Trigger<boolean>;

	private trackSpr: g.Sprite;
	private knobSpr: g.Sprite;
	private trackOnImageAsset: g.ImageAsset;
	private trackOffImageAsset: g.ImageAsset;

	private _value: boolean;
	private interactive: boolean;

	/** トラック左端の x 座標 (このエンティティのローカル座標)。 */
	private trackX: number;
	/** つまみが動ける範囲。 */
	private knobMinX: number;
	private knobMaxX: number;

	private dragging: boolean;
	private dragStartKnobX: number;
	private knobAnim: { from: number; to: number; cntr: number } | null;

	constructor(param: LateJoinSliderEParameterObject) {
		const height = Math.max(param.labelImageAsset.height, param.trackOnImageAsset.height);
		const width = param.labelImageAsset.width + GAP + param.trackOnImageAsset.width;

		super({
			...param,
			width,
			height,
			touchable: param.interactive
		});

		this.onValueChange = new g.Trigger<boolean>();
		this.trackOnImageAsset = param.trackOnImageAsset;
		this.trackOffImageAsset = param.trackOffImageAsset;
		this._value = param.value;
		this.interactive = param.interactive;
		this.dragging = false;
		this.dragStartKnobX = 0;
		this.knobAnim = null;

		// ラベルとトラックは縦中央で揃える。
		const labelSpr = new g.Sprite({
			scene: param.scene,
			src: param.labelImageAsset,
			y: (height - param.labelImageAsset.height) / 2
		});
		this.append(labelSpr);

		this.trackX = param.labelImageAsset.width + GAP;
		const trackY = (height - param.trackOnImageAsset.height) / 2;
		this.trackSpr = new g.Sprite({
			scene: param.scene,
			src: param.value ? param.trackOnImageAsset : param.trackOffImageAsset,
			x: this.trackX,
			y: trackY
		});
		this.append(this.trackSpr);

		this.knobMinX = this.trackX + KNOB_MARGIN;
		this.knobMaxX = this.trackX + param.trackOnImageAsset.width - param.knobImageAsset.width - KNOB_MARGIN;
		this.knobSpr = new g.Sprite({
			scene: param.scene,
			src: param.knobImageAsset,
			x: param.value ? this.knobMaxX : this.knobMinX,
			y: (height - param.knobImageAsset.height) / 2
		});
		this.append(this.knobSpr);

		if (this.interactive) {
			this.onPointDown.add(ev => {
				this.dragging = true;
				this.knobAnim = null;
				this.dragStartKnobX = this.knobSpr.x;
				this.moveKnobTo(ev.point.x);
			});
			this.onPointMove.add(ev => {
				if (this.dragging) {
					this.moveKnobTo(ev.point.x);
				}
			});
			this.onPointUp.add(() => {
				if (!this.dragging) {
					return;
				}
				this.dragging = false;

				let next: boolean;
				if (Math.abs(this.knobSpr.x - this.dragStartKnobX) < TAP_THRESHOLD) {
					// ほとんど動いていない時はタップとみなして反転させる。
					next = !this._value;
				} else {
					const center = (this.knobMinX + this.knobMaxX) / 2;
					next = this.knobSpr.x > center;
				}
				this.commitValue(next, true);
			});
		}

		this.onUpdate.add(() => this.updateKnobAnim());
	}

	get value(): boolean {
		return this._value;
	}

	/**
	 * 外から値を反映する。onValueChange は発火しない。
	 */
	setValue(v: boolean): void {
		this.commitValue(v, false);
	}

	private commitValue(v: boolean, notify: boolean): void {
		const changed = v !== this._value;
		this._value = v;

		this.trackSpr.src = v ? this.trackOnImageAsset : this.trackOffImageAsset;
		this.trackSpr.invalidate();

		const targetX = v ? this.knobMaxX : this.knobMinX;
		if (this.knobSpr.x !== targetX) {
			this.knobAnim = { from: this.knobSpr.x, to: targetX, cntr: 0 };
		}

		if (notify && changed) {
			this.onValueChange.fire(v);
		}
	}

	private moveKnobTo(pointX: number): void {
		const knobHalf = this.knobSpr.width / 2;
		const x = Math.min(this.knobMaxX, Math.max(this.knobMinX, pointX - knobHalf));
		this.knobSpr.x = x;
		this.knobSpr.modified();
	}

	private updateKnobAnim(): void {
		if (!this.knobAnim) {
			return;
		}

		this.knobAnim.cntr++;
		const t = Math.min(1, this.knobAnim.cntr / KNOB_ANIM_FRAMES);
		this.knobSpr.x = this.knobAnim.from + (this.knobAnim.to - this.knobAnim.from) * t;
		this.knobSpr.modified();

		if (t >= 1) {
			this.knobAnim = null;
		}
	}
}
