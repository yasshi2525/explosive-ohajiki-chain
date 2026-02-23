import type { GameMainParameterObject } from "./parameterObject";
import { initialize, hasRole, isSandbox } from "@akashic-extension/coe";
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

	const config = g.game.asset.getJSONContent("/assets/config.json") as Configuration;

	const userConfig = param.sessionParameter.config;

	if (userConfig) {
		utils.assign(config, userConfig);
	}

	// サーバ上で動作する進行役である active instance は常にログを出力する。
	const logger = new Logger(config.debug.enableLog || g.game.isActiveInstance());

	logger.info(`GameMainParameterObject: ${JSON.stringify(param)}`);
	logger.info(`User config: ${JSON.stringify(userConfig)}`);
	logger.info(`Config: ${JSON.stringify(config)}`);

	logger.info(`selfId: ${g.game.selfId}`);
	logger.info(`isSandbox(): ${isSandbox()}`);
	logger.info(`isActiveInstance(): ${g.game.isActiveInstance()}`);
	logger.info(`hasRole("broadcaster"): ${hasRole("broadcaster")}`);

	const isHost = hasRole("broadcaster");

	logger.info(`isHost: ${isHost}`);

	audio.init(config.audio, logger);

	const scene = new OhajikiScene({
		game: g.game,
		controller: new OhajikiController(logger, config.general.maxKokoPerSec),
		assetPaths
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
