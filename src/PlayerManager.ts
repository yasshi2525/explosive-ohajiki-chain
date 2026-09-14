import type { Player } from "./Player";
import type { Logger } from "./Logger";
import { lottery } from "./utils";

function findPlayer(players: Player[], id: string): Player | null {
	for (let i = 0; i < players.length; i++) {
		const player = players[i];
		if (player.id === id) {
			return player;
		}
	}

	return null;
}

/**
 * 待機列に並んだプレイヤーのデータ。
 */
export interface PlayerData {
	/** プレイヤー。 */
	player: Player;

	/** プレイヤーのおはじきのライフ。 */
	ohajikiLife: number;
}

/**
 * プレイヤーマネージャ。
 *
 * 以下の機能を持つ。
 *
 * - プレイヤーの登録。
 * - 試合に参加するプレイヤーの選抜（待機列に並べる）
 * - プレイヤーの待機列の保持・管理。
 * - プレイヤーのおはじきのライフ決定。
 */
export class PlayerManager {
	/**
	 * 抽選で選出される前のプレイヤー。
	 */
	players: Player[];

	/**
	 * 投石待機列。
	 */
	queue: PlayerData[];

	/**
	 * 抽選で選ばれたプレイヤー。
	 */
	winningPlayers: Player[];

	/**
	 * ２回自動投石して除名されたプレイヤー。
	 */
	bannedPlayers: Player[];

	/**
	 * プレイヤー追加イベントトリガー。
	 */
	playerAdded: g.Trigger<Player>;

	/**
	 * プレイヤー削除イベントトリガー。
	 */
	playerRemoved: g.Trigger<Player>;

	private rand: g.RandomGenerator;
	private ohajikiLifeDice: () => number;
	private logger: Logger;

	/**
	 * コンストラクタ。
	 *
	 * @param ohajikiLifeDice 待機列に並ぶプレイヤーに与えるおはじきのライフを決める関数。
	 * @param rand 抽選に用いる乱数生成器。
	 */
	constructor(ohajikiLifeDice: () => number, rand: g.RandomGenerator, logger: Logger) {
		this.logger = logger;

		this.players = [];
		this.queue = [];
		this.winningPlayers = [];
		this.bannedPlayers = [];
		this.ohajikiLifeDice = ohajikiLifeDice;
		this.rand = rand;
		this.playerAdded = new g.Trigger<Player>();
		this.playerRemoved = new g.Trigger<Player>();
	}

	/**
	 * プレイヤーの追加。
	 *
	 * BAN されたプレイヤー、登録済みプレイヤーは登録されない。
	 *
	 * 登録に成功した時、真を返す。
	 *
	 * @param player 追加するプレイヤー。
	 */
	addPlayer(player: Player): boolean {
		if (this.isBannedPlayer(player.id)) {
			return false;
		}

		if (this.findPlayer(player.id)) {
			return false;
		}

		this.players.push(player);

		this.playerAdded.fire(player);

		return true;
	}

	/**
	 * プレイヤーの削除。
	 *
	 * ただし BAN されたプレイヤーの管理リストからは削除しない。
	 *
	 * @param player プレイヤー。
	 */
	removePlayer(player: Player): void {
		// 管理下になければなにもしない。
		if (!this.findPlayer(player.id)) {
			return;
		}

		this.players = this.players.filter(p => p.id !== player.id);
		this.winningPlayers = this.winningPlayers.filter(p => p.id !== player.id);

		this.playerRemoved.fire(player);
	}

	/**
	 * プレイヤーの検索。
	 *
	 * ただし BAN されたプレイヤーは検索対象に含まれない。
	 *
	 * @param id プレイヤーID。
	 */
	findPlayer(id: string | undefined): Player | null {
		if (!id) {
			return null;
		}
		return findPlayer(this.players, id) || findPlayer(this.winningPlayers, id);
	}

	/**
	 * プレイヤーをBANする。
	 *
	 * BAN されたプレイヤーは BAN リストに追加され、プレイヤーリストから
	 * 削除される。
	 *
	 * ホストは BAN されない。
	 *
	 * @param player プレイヤー。
	 */
	ban(player: Player): void {
		if (player.isHost) {
			return;
		}

		this.forceBan(player);
	}

	/**
	 * ホスト(放送者)であってもプレイヤーをBANする。
	 *
	 * 実行基盤による追放のためのもの。追放されたプレイヤーは実行基盤から
	 * 切断されているので、放送者として登録されていても進行に残してはならない。
	 *
	 * @param player プレイヤー。
	 */
	forceBan(player: Player): void {
		if (!this.isBannedPlayer(player.id)) {
			this.bannedPlayers.push(player);
		}

		this.removePlayer(player);
	}

	/**
	 * BAN の解除。
	 *
	 * 解除できた時、そのプレイヤーを返す。
	 *
	 * 自動投石による除名も一緒に解く。実行基盤の解除は「また参加してよい」と
	 * いう明示の判断なので、コンテンツ側の除名理由を残して締め出し続けると
	 * 解除が効いていないようにしか見えない。
	 *
	 * 抽選対象には戻さない。参加はプレイヤー自身の操作に任せる。
	 *
	 * @param id プレイヤーID。
	 */
	unban(id: string): Player | null {
		const player = this.bannedPlayers.filter(banned => banned.id === id)[0];

		if (!player) {
			return null;
		}

		player.autoStrikeCount = 0;

		this.bannedPlayers = this.bannedPlayers.filter(
			banned => banned.id !== id
		);

		return player;
	}

	/**
	 * 投石待機列でのプレイヤーの位置を調べる。
	 *
	 * 待機列にいなければ -1 を返す。
	 *
	 * @param id プレイヤーID。
	 * @param fromIndex 探し始める位置。
	 */
	findQueueIndex(id: string, fromIndex: number = 0): number {
		for (let i = fromIndex; i < this.queue.length; i++) {
			if (this.queue[i].player.id === id) {
				return i;
			}
		}

		return -1;
	}

	/**
	 * 投石待機列からプレイヤーを取り除く。
	 *
	 * 補充は行わない。必要なら fillQueue() を呼ぶこと。
	 *
	 * @param index 取り除くプレイヤーの位置。
	 */
	removeQueueAt(index: number): PlayerData | null {
		if (index < 0 || index >= this.queue.length) {
			return null;
		}

		return this.queue.splice(index, 1)[0];
	}

	/**
	 * BANされたプレイヤーか調べる。
	 *
	 * @param id プレイヤーID。
	 */
	isBannedPlayer(id: string): boolean {
		const players = this.bannedPlayers.filter(banned => id === banned.id);
		return players.length > 0;
	}

	/**
	 * 待機列に３名並べる。
	 *
	 * 待機列の先頭は必ず host である。
	 *
	 * 現在の待機列は解散する。
	 */
	initQueue(): void {
		this.queue = [];
		for (let i = 0; i < this.winningPlayers.length; i++) {
			this.players.push(this.winningPlayers[i]);
		}
		this.winningPlayers = [];

		for (let i = 0; i < this.players.length; i++) {
			const player = this.players[i];
			if (player.isHost) {
				this.queue.push({
					player,
					ohajikiLife: this.ohajikiLifeDice()
				});
				this.winningPlayers.push(player);
				this.players.splice(i, 1);
				break;
			}
		}

		this.fillQueue();
	}

	/**
	 * 投石待機列に 3 名並ぶまで抽選する。
	 */
	fillQueue(): void {
		while (this.queue.length < 3) {
			const player = this.drawLots();
			if (!player) {
				break;
			}
		}
	}

	/**
	 * すべのプレイヤーの取得。
	 *
	 * @param excludeBanned 真の時 ban されたプレイヤーを除く。
	 */
	getAllPlayers(excludeBanned: boolean): Player[] {
		let players = this.players.concat(this.winningPlayers);

		if (!excludeBanned) {
			players = players.concat(this.bannedPlayers);
		}

		return players;
	}

	/**
	 * プレイヤーの交代。
	 *
	 * 待機列の先頭から一名取り除き、players から選抜して後ろに並べる。
	 */
	changePlayer(): void {
		this.queue.shift();
		this.fillQueue();
	}

	/**
	 * 現在のプレイヤーの取得。
	 */
	getCurrentPlayer(): Player {
		return this.queue[0].player;
	}

	/**
	 * 現在のプレイヤーのデータの取得。。
	 */
	getCurrentPlayerData(): PlayerData {
		return this.queue[0];
	}

	/**
	 * 待機列の最後のプレイヤーを取得。
	 */
	getLastQueuedPlayer(): Player | null {
		if (this.queue.length === 0) {
			return null;
		} else {
			return this.queue[this.queue.length - 1].player;
		}
	}

	/**
	 * 待機列の最後のプレイヤーデータを取得。
	 */
	getLastQueuedPlayerData(): PlayerData | null {
		if (this.queue.length === 0) {
			return null;
		} else {
			return this.queue[this.queue.length - 1];
		}
	}

	/**
	 * プレイヤーの当選率(0~1)を求める。
	 */
	calcWinningRate(): number {
		const totalPlayers = this.players.length + 1; // +1 for the new player
		return totalPlayers !== 0 ? 1 / totalPlayers : 0;
	}

	/**
	 * ログ出力。
	 *
	 * デバッグ用。
	 */
	log(title: string): void {
		const convp = (players: Player[]) => players.map(p => `{${p.id}}`).join();
		const convd = (datas: PlayerData[]) => datas.map(d => `{${d.player.id}, ${d.ohajikiLife}}`).join();

		this.logger.log(`PM: ${title}`);
		this.logger.log(`  players: ${convp(this.players)}`);
		this.logger.log(`  winners: ${convp(this.winningPlayers)}`);
		this.logger.log(`   banned: ${convp(this.bannedPlayers)}`);
		this.logger.log(`    queue: ${convd(this.queue)}`);
	}

	/**
	 * プレイヤーから抽選で１名選ぶ。
	 *
	 * 選ばれたプレイヤーは queue に追加される。
	 */
	private drawLots(): Player | null {
		if (this.players.length === 0) {
			this.players = this.winningPlayers;
			this.winningPlayers = [];
		}

		if (this.players.length === 0) {
			return null;
		}

		this.log("Before drawLots");

		const players = lottery(this.rand, this.players, 1);
		const player = players[0];

		this.players = this.players.filter(p => p !== player);

		this.queue.push({
			player,
			ohajikiLife: this.ohajikiLifeDice()
		});

		this.winningPlayers.push(player);

		this.log("After drawLots");

		return player;
	}
}
