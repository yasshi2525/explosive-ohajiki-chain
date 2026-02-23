import type * as tl from "@akashic-extension/akashic-timeline";
import type { System } from "../System";
import type { Player } from "../Player";

/**
 * あるオブジェクトに、別のオブジェクトのプロパティを割り当てる。
 *
 * @param target 割り当てられるオブジェクト。
 * @param sources 割り当てるプロパティを持つオブジェクト(可変長)。
 */
export function assign(target: any, ...sources: Record<string, any>[]): any {
	const to = Object(target);

	for (let i = 0; i < sources.length; i++) {
		const nextSource = sources[i];
		if (nextSource != null) { // Skip over if undefined or null
			for (const nextKey in nextSource) {
				// Avoid bugs when hasOwnProperty is shadowed
				if (Object.prototype.hasOwnProperty.call(nextSource, nextKey)) {
					// 配列の場合は要素ごとのマージではなく、配列全体を置き換える。
					// 例: 10要素の配列を2要素の配列で上書きする場合、結果は2要素の配列になる。
					// オブジェクトの場合は従来通り深くマージする。
					if (Array.isArray(nextSource[nextKey])) {
						to[nextKey] = nextSource[nextKey];
					} else if (nextSource[nextKey] != null && typeof nextSource[nextKey] === "object") {
						to[nextKey] = assign(to[nextKey], nextSource[nextKey]);
					} else {
						to[nextKey] = nextSource[nextKey];
					}
				}
			}
		}
	}

	return to;
}

/**
 * text の中の位置 idx にある文字を描画したときの横幅 (pixels) を求める。
 *
 * @param text 文字列
 * @param font font object
 * @param fontSize フォントサイズ
 * @param idx textの対象となるindex。default: 0
 */
export function calcCharWidth(text: string, font: g.Font, fontSize: number, idx: number) {
	const code = g.Util.charCodeAt(text, idx);
	if (!code) { // idx文字目が下位サロゲートの時null
		return 0;
	}
	const glyph = font.glyphForCharacter(code);
	if (!glyph) {
		return 0;
	}
	return glyph.advanceWidth * (fontSize / font.size);
}

/**
 * text 描画したときの横幅 (pixels) を求める。
 *
 * @param text 対象となる文字列
 * @param font fontObject
 * @param fontSize フォントサイズ
 */
export function calcTextWidth(text: string, font: g.Font, fontSize: number): number {
	let width = 0;
	for (let idx = 0; idx < text.length; idx++) {
		width += calcCharWidth(text, font, fontSize, idx);
	}
	return width;
}

/**
 * 文字列 text が maxWidth で指定された幅 (pixel) を超えているとき、超えた部分を切り捨てる。
 *
 * news-bot から転用。
 *
 * @param text 文字列。
 * @param maxWidth 最大文字列幅 (pixel) 。
 * @param font フォント。
 * @param fontSize フォントサイズ。
 * @param suffix? 切り捨てられた文字列の代替となる文字列。
 */
export function limitTextByWidth(text: string, maxWidth: number, font: g.Font, fontSize: number, suffix?: string): string {
	suffix = suffix || suffix === "" ? suffix : "...";
	const suffixWidth = calcTextWidth(suffix, font, fontSize);

	let limitedIdx: number | undefined;
	let lineWidth = 0;
	for (let idx = 0; idx < text.length; idx++) {
		const width = calcCharWidth(text, font, fontSize, idx);
		if (limitedIdx == null && lineWidth + width + suffixWidth > maxWidth) {
			limitedIdx = idx; // 後ほど idx 文字目の文字は含めないよう扱う
		}
		lineWidth += width;
	}

	if (lineWidth <= maxWidth) {
		return text;
	} else {
		return text.slice(0, limitedIdx) + suffix; // suffixWidth > maxWidth のケースでも suffix が含まれる。
	}
}

/**
 * テンプレートテキストに値を埋め込む。
 *
 * @param template ${key} の形式の箇所に値を埋め込む場所を指定されたテキスト。
 * @param keyValues ${key} に対して埋め込む値を保持した key-value オブジェクト。
 */
export function finalizeTemplate(template: string, keyValues: Record<string, string>): string {
	let msg = template;

	Object.keys(keyValues).forEach(key => {
		const regex = new RegExp("\\$\\{" + key +  "\\}", "g");
		msg = msg.replace(regex, keyValues[key]);
	});

	return msg;
}

/**
 * タイムラインが完了している時、真。
 *
 * 完了した tween は破棄されるので _tween の要素数で判定している。
 *
 * @param timeline タイムライン。
 */
export function isTimelineFinished(timeline: tl.Timeline): boolean {
	return timeline._tweens.length === 0;
}

/**
 * プレイヤー登録を行う。
 *
 * @param context システムコンテキスト
 */
export function applyForPlay(context: System): void {
	context.scene.send({
		type: "apply",
		isHost: context.isHost,
		name: context.displayName
	});
}

/**
 * "go-result" アクションを送信する。
 *
 * リザルト用の受賞者決定を行う。そのためのプレイ記録は active instance で
 * のみ集計されていることに注意。
 *
 * @param context
 */
export function sendGoResult(context: System): void {
	const players = context.playerManager.getAllPlayers(true);

	// 同点の扱い:
	// 同点首位の場合は配列上で最初に見つかったプレイヤーを選んでいる。
	// ただし、すでに他の賞を取っている場合は選ばないようにする。

	// ソートの安定性:
	// Array#sort() は unstable で、もしかすると実行環境で結果が異なるかもしれない。
	// sendGoResult() を実行するのが active instance だけである限り、
	// 問題にならない。

	// ナイス受賞者。
	const niceOrderedPlayers = players
		.filter(player => player.playRecord.nice > 0)
		.sort((a, b) => b.playRecord.nice - a.playRecord.nice);
	const niceWinner = niceOrderedPlayers[0];

	// コンボ受賞者。
	const comboWinners = players
		.sort((a, b) => b.playRecord.combo - a.playRecord.combo)
		.filter((player, _idx, arr) => player.playRecord.combo === arr[0].playRecord.combo);
	const nonTitleComboWinners = comboWinners.filter(player => player !== niceWinner);
	const comboWinner = nonTitleComboWinners[0] || comboWinners[0];

	// 九死に一生賞受賞者。
	const narrowEscapePlayers =
		players
			.filter(player => player.playRecord.narrowEscape != null)
			.sort((a, b) => b.playRecord.narrowEscape!.norma - a.playRecord.narrowEscape!.norma)
			.filter((player, _idx, arr) => player.playRecord.narrowEscape!.norma === arr[0].playRecord.narrowEscape!.norma);
	const nonTitleNarrowEscapeWinners = narrowEscapePlayers.filter(player => [niceWinner, comboWinner].indexOf(player));
	const narrowEscapeWinner = nonTitleNarrowEscapeWinners[0] || narrowEscapePlayers[0];

	context.scene.send({
		type: "go-result",
		difficulty: context.difficulty,
		worldId: context.worldId,
		areaId: context.areaId,
		niceAward: niceWinner ? {
			name: niceWinner.screenName || niceWinner.name || niceWinner.id,
			num: niceWinner.playRecord.nice
		} : null,
		comboAward: comboWinner ? {
			name: comboWinner.screenName || comboWinner.name || comboWinner.id,
			num: comboWinner.playRecord.combo
		} : null,
		narrowEscapeAward: narrowEscapeWinner ? {
			name: narrowEscapeWinner.screenName || narrowEscapeWinner.name || narrowEscapeWinner.id,
			worldId: narrowEscapeWinner.playRecord.narrowEscape!.worldId,
			areaId: narrowEscapeWinner.playRecord.narrowEscape!.areaId
		} : null
	});
}

/**
 * min以上max以下の整数をランダムに返す。
 *
 * deprecated となった RandomGenerator.get(min, max) の代替関数。
 *
 * @param generator RandomGeneratorインスタンス
 * @param min 最小値（この値を含む）
 * @param max 最大値（この値を含む）
 * @returns min以上max以下の整数
 *
 * @example
 * random(g.game.random, 0, 1)    // 0 または 1
 * random(g.game.random, 5, 10)   // 5, 6, 7, 8, 9, 10 のいずれか
 * random(g.game.random, -1, 1)   // -1, 0, 1 のいずれか
 */
export function randomInt(generator: g.RandomGenerator, min: number, max: number): number {
	return Math.floor(generator.generate() * (max - min + 1)) + min;
}

/**
 * プレイヤーを公平に抽選する。
 *
 * Fisher-Yates シャッフルアルゴリズムを使用して公平な抽選を実現。
 *
 * @param rand 乱数生成器
 * @param players 抽選対象のプレイヤー配列
 * @param num 抽選する人数
 * @returns 抽選されたプレイヤー配列
 */
export function lottery(rand: g.RandomGenerator, players: Player[], num: number): Player[] {
	// 元の配列を変更しないようにコピー
	const shuffled = [...players];

	// Fisher-Yates シャッフル
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(rand.generate() * (i + 1));
		const temp = shuffled[i];
		shuffled[i] = shuffled[j];
		shuffled[j] = temp;
	}

	// 先頭から指定人数を返す
	return shuffled.slice(0, Math.min(num, shuffled.length));
}
