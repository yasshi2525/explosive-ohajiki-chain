/*
 * プレイ記録の実行基盤への報告。
 *
 * 報告が登録されるのはアクティブインスタンスからの呼び出しだけなので
 * (see: @multi-indiegame/akashic-scoreboard)、集計もアクティブインスタンスの
 * 持つ値だけが意味を持つ。
 *
 * 集計の入力はコマンド経路(= 全インスタンスが同じ順序で受け取る)と
 * onPlayerBanned で与えられるため、ここでの計算は決定的である。ただし
 * ゲーム状態は一切変更しないので、仮に食い違っても進行は壊れない。
 */

import * as scoreboard from "@multi-indiegame/akashic-scoreboard";
import type { Logger } from "./Logger";
import type { Player } from "./Player";
import type { System } from "./System";

/**
 * 「ステージ2」の worldId 。
 *
 * worldId / areaId は 0 始まりで、表示上の 2-1 が worldId = 1, areaId = 0 。
 */
const STAGE2_WORLD_ID = 1;

/** 単独プレイとみなす、同一プレイヤーの投球比率。 */
const SOLO_STRIKE_RATIO = 0.925;

/** 大人数プレイとみなす参加者数。 */
const PARTY_PLAYER_COUNT = 5;

/**
 * プレイ記録の集計と報告を行う。
 */
export class ScoreReporter {
	private logger: Logger;

	/**
	 * 2-1 開始時点の参加者のうち、まだ追放されていない者のID。
	 *
	 * まだ 2-1 に到達していない時 null 。
	 */
	private stage2Survivors: { [playerId: string]: true } | null;

	/** プレイヤーごとの投球数。 */
	private strikeCounts: { [playerId: string]: number };

	/** 総投球数。 */
	private totalStrikes: number;

	/**
	 * ステージ2以降の参加者数の最小値。
	 *
	 * まだ 2-1 に到達していない時 -1 。
	 */
	private minPlayerCountSinceStage2: number;

	constructor(logger: Logger) {
		this.logger = logger;
		this.stage2Survivors = null;
		this.strikeCounts = {};
		this.totalStrikes = 0;
		this.minPlayerCountSinceStage2 = -1;
	}

	/**
	 * レベルの開始に追従する。
	 *
	 * 2-1 の開始時点の参加者を、クリア報酬を配る相手の母集団として控える。
	 *
	 * @param context
	 */
	onLevelStart(context: System): void {
		if (context.worldId < STAGE2_WORLD_ID || this.stage2Survivors != null) {
			return;
		}

		const players = context.playerManager.getAllPlayers(true);
		const survivors: { [playerId: string]: true } = {};

		players.forEach(player => {
			survivors[player.id] = true;
		});

		this.stage2Survivors = survivors;
		this.minPlayerCountSinceStage2 = players.length;

		this.logger.info(
			`ScoreReporter: stage 2 started with ${players.length} player(s).`
		);
	}

	/**
	 * 参加者数の変化に追従する。
	 *
	 * ステージ2以降の最小人数を更新する。
	 *
	 * @param context
	 */
	onPlayerCountChanged(context: System): void {
		// ステージ2に達していなければ、大人数プレイの判定に関わらない。
		if (this.minPlayerCountSinceStage2 < 0) {
			return;
		}

		const count = context.playerManager.getAllPlayers(true).length;

		if (count < this.minPlayerCountSinceStage2) {
			this.minPlayerCountSinceStage2 = count;
		}
	}

	/**
	 * プレイヤーの追放に追従する。
	 *
	 * 追放された相手は「クリア時まで参加し続けた」に当たらないので母集団から外す。
	 * 追放が解除されても戻さない。抜けがあった事実は変わらないため。
	 *
	 * @param playerId 追放されたプレイヤーのID。
	 */
	onPlayerBanned(playerId: string): void {
		if (this.stage2Survivors) {
			delete this.stage2Survivors[playerId];
		}
	}

	/**
	 * 投球に追従する。
	 *
	 * 自動投石も、その手番の投球として数える。
	 *
	 * @param playerId 投球したプレイヤーのID。
	 */
	onStrike(playerId: string): void {
		this.strikeCounts[playerId] = (this.strikeCounts[playerId] ?? 0) + 1;
		this.totalStrikes++;
	}

	/**
	 * プレイの結果を報告する。
	 *
	 * ゲームオーバー・ゲームクリアのどちらでも呼ぶこと。
	 *
	 * @param context
	 * @param gameClear 真の時、全ステージクリア。
	 * @param narrowEscapeWinner 九死に一生賞の受賞者。不在の時 null 。
	 */
	report(
		context: System,
		gameClear: boolean,
		narrowEscapeWinner: Player | null
	): void {
		// 報告が通るのはアクティブインスタンスだけである。
		// 動作は変わらないが、意図をコードに残すため明示的に囲む。
		if (!g.game.isActiveInstance()) {
			return;
		}

		const difficulty = context.difficulty;
		const players = context.playerManager.getAllPlayers(true);

		// 最大コンボ数は、クリア・ゲームオーバーによらず全員ぶん報告する。
		players.forEach(player => {
			scoreboard.setPlayerRecord(player.id, {
				[`max-combo-${difficulty}`]: player.playRecord.combo
			});
		});

		if (narrowEscapeWinner) {
			scoreboard.setPlayerRecord(narrowEscapeWinner.id, {
				[`narrow-escape-award-${difficulty}`]: true
			});
		}

		this.logger.info(
			`ScoreReporter: reported ${players.length} player record(s). ` +
				`gameClear = ${gameClear}, ` +
				`narrowEscapeWinner = ${narrowEscapeWinner ? narrowEscapeWinner.id : "none"}`
		);

		if (!gameClear) {
			return;
		}

		this.reportGameClear(context, players);
	}

	/**
	 * 全ステージクリアの記録を報告する。
	 *
	 * @param context
	 * @param players 追放されていない参加者。
	 */
	private reportGameClear(context: System, players: Player[]): void {
		const clearKey = `game-clear-${context.difficulty}`;

		// 2-1 開始時点で参加しており、クリア時まで残った参加者。
		const survivors = players.filter(
			player => !!this.stage2Survivors && this.stage2Survivors[player.id]
		);

		scoreboard.setPlayRecord({ [clearKey]: true });
		survivors.forEach(player => {
			scoreboard.setPlayerRecord(player.id, { [clearKey]: true });
		});

		// 2-1 開始時点から残った参加者でなければクリア記録自体を受け取らないので、
		// 単独プレイの記録も与えない。
		const soloPlayerId = this.findSoloPlayerId();
		const soloWinnerId =
			soloPlayerId != null &&
			survivors.some(player => player.id === soloPlayerId)
				? soloPlayerId
				: null;

		if (soloWinnerId != null) {
			scoreboard.setPlayRecord({ [`${clearKey}-solo`]: true });
			scoreboard.setPlayerRecord(soloWinnerId, {
				[`${clearKey}-solo`]: true
			});
		}

		const party = this.minPlayerCountSinceStage2 >= PARTY_PLAYER_COUNT;

		if (party) {
			scoreboard.setPlayRecord({ [`${clearKey}-party`]: true });
			survivors.forEach(player => {
				scoreboard.setPlayerRecord(player.id, {
					[`${clearKey}-party`]: true
				});
			});
		}

		this.logger.info(
			`ScoreReporter: reported ${clearKey} to the play and ` +
				`${survivors.length} player(s). ` +
				`solo = ${soloWinnerId ?? "none"} ` +
				`(${this.totalStrikes} strike(s)), ` +
				`party = ${party} (min ${this.minPlayerCountSinceStage2} player(s))`
		);
	}

	/**
	 * 投球のほとんどを一人で行ったプレイヤーのIDを求める。
	 *
	 * 該当者がいない時 null 。
	 *
	 * SOLO_STRIKE_RATIO は 0.5 より大きいので、該当者は高々一人である。
	 */
	private findSoloPlayerId(): string | null {
		if (this.totalStrikes <= 0) {
			return null;
		}

		const ids = Object.keys(this.strikeCounts);

		for (let i = 0; i < ids.length; i++) {
			const id = ids[i];
			if (this.strikeCounts[id] / this.totalStrikes >= SOLO_STRIKE_RATIO) {
				return id;
			}
		}

		return null;
	}
}
