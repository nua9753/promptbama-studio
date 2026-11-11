<?php
/**
 * Plugin Name:       PromptBama Studio — استودیو عکس هوش مصنوعی
 * Plugin URI:        https://promptbama.com
 * Description:       ویجت ساخت پرتره با هوش مصنوعی داخل مقاله‌ها. کاربر بدون ترک سایت شما استایل انتخاب می‌کند، سلفی می‌دهد، پرداخت می‌کند و پرتره‌اش را می‌گیرد. همه‌ی پردازش، کیف‌پول و پرداخت روی پرامپت باما انجام می‌شود.
 * Version:           1.8.4
 * Update URI:        https://github.com/nua9753/promptbama-studio
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            PromptBama
 * Author URI:        https://promptbama.com
 * License:           GPL-2.0-or-later
 * Text Domain:       promptbama-studio
 * Domain Path:       /languages
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'PBS_VERSION', '1.8.4' );
define( 'PBS_FILE', __FILE__ );
define( 'PBS_DIR', plugin_dir_path( __FILE__ ) );
define( 'PBS_URL', plugin_dir_url( __FILE__ ) );

require_once PBS_DIR . 'includes/class-pbs-options.php';
require_once PBS_DIR . 'includes/class-pbs-api.php';
require_once PBS_DIR . 'includes/class-pbs-stats.php';
require_once PBS_DIR . 'includes/class-pbs-frontend.php';
require_once PBS_DIR . 'includes/class-pbs-widget.php';
require_once PBS_DIR . 'includes/class-pbs-admin.php';
require_once PBS_DIR . 'includes/class-pbs-updater.php';

PBS_Updater::init();

register_activation_hook( __FILE__, array( 'PBS_Stats', 'install' ) );

add_action(
	'plugins_loaded',
	static function () {
		load_plugin_textdomain( 'promptbama-studio', false, dirname( plugin_basename( PBS_FILE ) ) . '/languages' );
		PBS_Stats::maybe_upgrade();
		PBS_Stats::init();
		PBS_Frontend::init();
		if ( is_admin() ) {
			PBS_Admin::init();
		}
	}
);

add_action(
	'widgets_init',
	static function () {
		register_widget( 'PBS_Sidebar_Widget' );
	}
);

add_filter(
	'plugin_action_links_' . plugin_basename( __FILE__ ),
	static function ( $links ) {
		$url = admin_url( 'admin.php?page=promptbama-studio' );
		array_unshift( $links, '<a href="' . esc_url( $url ) . '">' . esc_html__( 'تنظیمات', 'promptbama-studio' ) . '</a>' );
		if ( current_user_can( 'update_plugins' ) ) {
			$check   = wp_nonce_url( admin_url( 'admin-post.php?action=pbs_check_update' ), 'pbs_check_update' );
			$links[] = '<a href="' . esc_url( $check ) . '">' . esc_html__( 'بررسی به‌روزرسانی', 'promptbama-studio' ) . '</a>';
		}
		return $links;
	}
);
