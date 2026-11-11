<?php
namespace MediaWiki\Extension\InlineComments;

use MediaWiki\Html\Html;
use MediaWiki\Linker\Linker;
use MediaWiki\User\ActorStore;
use MediaWiki\User\User;
use MediaWiki\User\UserFactory;
use Wikimedia\Rdbms\LBFactory;

class AnnotationUtils {
	public const SERVICE_NAME = 'InlineComments:AnnotationUtils';

	private UserFactory $userFactory;
	private ActorStore $actorStore;
	private LBFactory $dbLoadBalancerFactory;

	private array $userIds;

	public function __construct(
		UserFactory $userFactory,
		LBFactory $dbLoadBalancerFactory,
		ActorStore $actorStore
	) {
		$this->userFactory = $userFactory;
		$this->dbLoadBalancerFactory = $dbLoadBalancerFactory;
		$this->actorStore = $actorStore;
		$this->userIds = [];
	}

	public function renderComment(
		int $actorId,
		string $timestamp,
		string $comment,
		bool $editable = false,
		?string $annotationId = null
	): array {
		$this->userIds = [];
		$commentHTML = preg_replace_callback(
			'/@(\S+)/u',
			[ $this, 'handleUserMention' ],
			$comment
		);
		$commentHTML = Html::rawElement(
			'p',
			[],
			str_replace( "\n", '<br>', $commentHTML )
		);
		$user = $this->userFactory->newFromActorId( $actorId );
		$username = $user->getName();
		if ( $user->isHidden() ) {
			$displayName = Html::element(
				'span',
				[ 'class' => 'history-deleted mw-history-suppressed' ],
				wfMessage( 'rev-deleted-user' )->text()
			);
		} else {
			$displayName = Linker::userLink( $user->getId(), $username );
		}
		$commentHTML .= Html::rawElement(
			'div',
			[ 'class' => 'mw-inlinecomment-author' ],
			$displayName . $timestamp
		);
		$commentHTML = Html::rawElement(
			'div',
			[],
			$commentHTML
		);
		$buttonsHTML = '';
		if ( $annotationId !== null ) {
			$buttonsHTML .= Html::element(
				'button',
				[
					'class' => 'mw-inlinecomment-copylink',
					'title' => wfMessage( 'inlinecomments-copy-link' )->text(),
					'aria-label' => wfMessage( 'inlinecomments-copy-link' )->text(),
					'data-annotation-id' => $annotationId,
				]
			);
		}
		if ( $editable ) {
			$buttonsHTML .= Html::element(
				'button',
				[
					'class' => 'mw-inlinecomment-editlink',
					'title' => wfMessage( 'edit' )->text(),
					'aria-label' => wfMessage( 'edit' )->text(),
				]
			) .
			Html::element(
				'button',
				[
					'class' => 'mw-inlinecomment-delete-reply',
					'title' => wfMessage( 'inlinecomments-delete-reply' )->text(),
					'aria-label' => wfMessage( 'inlinecomments-delete-reply' )->text(),
				]
			);
		}
		if ( $buttonsHTML !== '' ) {
			$commentHTML .= $buttonsHTML;
		}
		$commentHTML = Html::rawElement(
			'div',
			[ 'class' => 'mw-inlinecomment-comment' ],
			$commentHTML
		);
		$result = [
			'commentHTML' => $commentHTML,
			'userIds' => $this->userIds
		];
		return $result;
	}

	/**
	 * Replace user mention text with appropriate user link
	 *
	 * @param array $matches
	 * @return string replacement
	 */
	private function handleUserMention( array $matches ): string {
		$match = $matches[1];
		$replacement = "@$match";
		$mentionedUser = $this->userFactory->newFromName( $match );
		if ( $mentionedUser ) {
			$mentionedUserId = $mentionedUser->getId();
			if ( $mentionedUserId && !$mentionedUser->isHidden() ) {
				$displayName = str_replace( '_', ' ', $match );
				$link = Linker::userLink( $mentionedUserId, $mentionedUser->getName(), $displayName );
				$replacement = "@$link";
				$this->userIds[] = $mentionedUser->getId();
			}
		}
		return $replacement;
	}

	/**
	 * Returns the actor ID of the user
	 * @param User $user
	 * @return int actorId
	 */
	public function getActorId( User $user ): int {
		$db = $this->dbLoadBalancerFactory->getPrimaryDatabase();
		$actorId = $this->actorStore->acquireActorId( $user, $db );
		return $actorId;
	}
}
