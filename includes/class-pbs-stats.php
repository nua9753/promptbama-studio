<?php
/**
 * Lightweight funnel analytics, kept on the WordPress side: daily counters per
 * design variant and event (no personal data). Fed by the widget through a
 * small REST endpoint, shown on the plugin dashboard for the A/B comparison.
 *
 * @package PromptBamaStudio
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

class PBS_Stats {

	const DB_VERSION = '1';

	/** Funnel steps in order (label => event). */
	public static function events() {
		return array(
			'view'     => __( 'دیدن کارت', 'promptbama-studio' ),
			'open'     => __( 'باز کردن ویجت', 'promptbama-studio' ),
			'selfie'   => __( 'افزودن سلفی', 'promptbama-studio' ),
			'auth'     => __( 'ورود / ثبت‌نام', 'promptbama-studio' ),
			'checkout' => __( 'رفتن به درگاه', 'promptbama-studio' ),
			'paid'     => __( 'پرداخت موفق', 'promptbama-studio' ),
			'generate' => __( 'شروع ساخت', 'promptbama-studio' ),
			'delivered' => __( 'تحویل پرتره', 'promptbama-studio' ),
		);
	}

	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'pbs_events';
	}

	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$charset = $wpdb->get_charset_collate();
		$table   = self::table();
		dbDelta(
			"CREATE TABLE {$table} (
				day date NOT NULL,
				variant char(1) NOT NULL,
				event varchar(20) NOT NULL,
				hits int(10) unsigned NOT NULL DEFAULT 0,
				PRIMARY KEY  (day,variant,event)
			) {$charset};"
		);
		update_option( 'pbs_db_version', self::DB_VERSION, false );
	}

	public static function maybe_upgrade() {
		if ( get_option( 'pbs_db_version' ) !== self::DB_VERSION ) {
			self::install();
		}
	}

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	public static function routes() {
		register_rest_route(
			'pbs/v1',
			'/track',
			array(
				'methods'             => 'POST',
				'permission_callback' => '__return_true',
				'callback'            => array( __CLASS__, 'track' ),
				'args'                => array(
					'event'   => array( 'type' => 'string', 'required' => true ),
					'variant' => array( 'type' => 'string', 'required' => true ),
				),
			)
		);
	}

	/** Public, anonymous counter increment (whitelisted values only). */
	public static function track( WP_REST_Request $req ) {
		$event   = sanitize_key( (string) $req->get_param( 'event' ) );
		$variant = strtolower( substr( (string) $req->get_param( 'variant' ), 0, 1 ) );
		if ( ! array_key_exists( $event, self::events() ) || ! in_array( $variant, array( 'a', 'b', 'c' ), true ) ) {
			return new WP_REST_Response( array( 'ok' => false ), 400 );
		}

		// Soft per-IP throttle against counter flooding.
		$ip   = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		$tkey = 'pbs_t_' . md5( $ip . '|' . gmdate( 'YmdH' ) );
		$n    = (int) get_transient( $tkey );
		if ( $n > 300 ) {
			return new WP_REST_Response( array( 'ok' => false ), 429 );
		}
		set_transient( $tkey, $n + 1, HOUR_IN_SECONDS );

		global $wpdb;
		$table = self::table();
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$wpdb->query(
			$wpdb->prepare(
				"INSERT INTO {$table} (day, variant, event, hits) VALUES (%s, %s, %s, 1) ON DUPLICATE KEY UPDATE hits = hits + 1", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				current_time( 'Y-m-d' ),
				$variant,
				$event
			)
		);
		return new WP_REST_Response( array( 'ok' => true ), 200 );
	}

	/**
	 * Totals per variant and event for the last $days days.
	 *
	 * @return array [ 'a' => [ event => hits ], 'b' => [...] ]
	 */
	public static function totals( $days = 30 ) {
		global $wpdb;
		$table = self::table();
		$since = gmdate( 'Y-m-d', strtotime( current_time( 'Y-m-d' ) . ' -' . absint( $days ) . ' days' ) );
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT variant, event, SUM(hits) AS hits FROM {$table} WHERE day >= %s GROUP BY variant, event", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				$since
			),
			ARRAY_A
		);
		$out = array(
			'a' => array_fill_keys( array_keys( self::events() ), 0 ),
			'b' => array_fill_keys( array_keys( self::events() ), 0 ),
			'c' => array_fill_keys( array_keys( self::events() ), 0 ),
		);
		foreach ( (array) $rows as $r ) {
			if ( isset( $out[ $r['variant'] ][ $r['event'] ] ) ) {
				$out[ $r['variant'] ][ $r['event'] ] = (int) $r['hits'];
			}
		}
		return $out;
	}

	public static function reset() {
		global $wpdb;
		$table = self::table();
		$wpdb->query( "TRUNCATE TABLE {$table}" ); // phpcs:ignore WordPress.DB
	}
}
