/*
 * ステートクラス群で共有する機能。
 */

import type * as msg from "../coeMessages";
import type { System } from "../System";
import { Player } from "../Player";

/**
 * AddPlayerCommand を処理する。
 *
 * Player インスタンスを生成し PlayerManager に登録する。
 *
 * @param context
 * @param command
 */
export function handleAddPlayerCommand(context: System, command: msg.AddPlayerCommand): void {
	const player = new Player(command.player);
	player.isHost = command.isHost;
	player.screenName = command.name;

	// 2-1 以降の途中参加が締め切られている時は登録しない。
	// 申請が通信ラグで締め切りの後に届くことがあるので、すでに登録済みの
	// プレイヤーでなければ、申請した本人にだけ締め切りを通知する。
	if (context.isLateJoinClosed()) {
		if (!context.playerManager.findPlayer(player.id)) {
			context.logger.log(`Cancel adding a player because late join is closed. Player: ${JSON.stringify(player)}`);
			if (player.id === g.game.selfId) {
				context.showLateJoinClosedMessage();
			}
		}
		return;
	}

	// 念の為。
	if (context.playerManager.isBannedPlayer(player.id)) {
		context.logger.log(`Cancel adding a player because it's a banned player. Player: ${JSON.stringify(player)}`);
	} else {
		const result = context.playerManager.addPlayer(player);
		if (result) {
			if (context.inPlayApplyButton && player.id === g.game.selfId) {
				context.inPlayApplyButton.hide();
				context.hideLateJoinClosedNotice();
			}
			context.logger.log(`Add a player. Player: ${JSON.stringify(player)}`);
		} else {
			context.logger.log(`Failed to add a player. Player: ${JSON.stringify(player)}`);
		}
	}
}
