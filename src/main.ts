import type { GameMainParameterObject } from "./parameterObject";
import { initialize, hasRole, isSandbox } from "@akashic-extension/coe";
import { attachCoeController } from "@multi-indiegame/akashic-player-ban-coe";
import { System, OhajikiScene } from "./System";
import { SystemRunner } from "./SystemRunner";
import { OhajikiController } from "./OhajikiController";
import { Logger } from "./Logger";
import * as utils from "./utils";
import * as audio from "./audio";
import type { Configuration } from "./Configuration";

// v3: ワイルドカードで全アセットを一括読み込み
const assetPaths = ["/assets/**/*"];

function gameMain(param: GameMainParameterObject): void {
	initialize({ game: g.game, args: param });

	const config = g.game.asset.getJSONContent(
		"/assets/config.json",
	) as Configuration;

	const userConfig = param.sessionParameter.config;

	if (userConfig) {
		utils.assign(config, userConfig);
	}

	// サーバ上で動作する進行役である active instance は常にログを出力する。
	const logger = new Logger(
		config.debug.enableLog || g.game.isActiveInstance(),
	);

	logger.info(`GameMainParameterObject: ${JSON.stringify(param)}`);
	logger.info(`User config: ${JSON.stringify(userConfig)}`);
	logger.info(`Config: ${JSON.stringify(config)}`);

	logger.info(`selfId: ${g.game.selfId}`);
	logger.info(`isSandbox(): ${isSandbox()}`);
	logger.info(`isActiveInstance(): ${g.game.isActiveInstance()}`);
	logger.info(`hasRole("broadcaster"): ${hasRole("broadcaster")}`);

	// 放送者(みんなでゲーム! でいう部屋主)のインスタンスか。
	// 実行基盤が args.coe.roles を配るので、アクティブインスタンスとは独立に
	// 放送者のパッシブインスタンスだけが true になる。
	// NOTE: args.coe が無い環境(sandbox、akashic serve)では coe が
	// isActiveInstance() で代用するため、放送者を指さない。
	const isHost = hasRole("broadcaster");

	logger.info(`isHost: ${isHost}`);

	audio.init(config.audio, logger);

	const controller = new OhajikiController(
		logger,
		config.general.maxKokoPerSec,
	);

	// coe は g.MessageEvent を握り潰すので、実行基盤の追放通知は
	// アダプタに Controller の broadcast 経路へ載せ替えてもらう。
	// Scene を作る前に呼ぶこと。
	attachCoeController(controller);

	const scene = new OhajikiScene({
		game: g.game,
		controller,
		assetPaths,
	});

	scene.onLoad.addOnce(() => {
		const system = new System(scene, isHost, config, logger);
		const systemRunner = new SystemRunner(system);
		systemRunner.start();
	});

	g.game.pushScene(scene);
}

export function main(param: GameMainParameterObject): void {
	gameMain(param);
}
