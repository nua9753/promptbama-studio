<?php
/**
 * Remove plugin data on uninstall (settings, caches, counters table).
 *
 * @package PromptBamaStudio
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

delete_option( 'pbs_settings' );
delete_option( 'pbs_db_version' );
delete_transient( 'pbs_categories' );
delete_transient( 'pbs_remote_stats' );

global $wpdb;
$pbs_table = $wpdb->prefix . 'pbs_events';
$wpdb->query( "DROP TABLE IF EXISTS {$pbs_table}" ); // phpcs:ignore WordPress.DB
