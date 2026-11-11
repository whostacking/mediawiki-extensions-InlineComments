<?php
namespace MediaWiki\Extension\InlineComments\Special;

use MediaWiki\Html\Html;
use MediaWiki\Linker\Linker;
use MediaWiki\MediaWikiServices;
use MediaWiki\SpecialPage\SpecialPage;
use MediaWiki\Title\Title;

class SpecialInlineComments extends SpecialPage {
	public function __construct() {
		parent::__construct( 'InlineComments' );
	}

	public function getDescription() {
		return $this->msg( 'inlinecomments-special-title' )->text();
	}

	public function execute( $subPage ) {
		$out = $this->getOutput();
		$out->setPageTitle( $this->msg( 'inlinecomments-special-title' )->text() );
		$out->addHelpLink( 'Extension:InlineComments' );
		$out->addModuleStyles( 'ext.inlineComments.sidenotes.styles' );

		// Optional page subpage: Special:InlineComments/Title
		$pageTitle = null;
		if ( $subPage ) {
			$pageTitle = Title::newFromText( $subPage );
		}
		$reqPage = $this->getRequest()->getText( 'page' );
		if ( !$pageTitle && $reqPage ) {
			$pageTitle = Title::newFromText( $reqPage );
		}

		// If a specific page is requested, show that page's comments
		if ( $pageTitle && $pageTitle->exists() ) {
			$this->showForPage( $pageTitle, $out );
			return;
		}

		// Otherwise show all pages with unclosed comments
		$this->showAll( $out );
	}

	private function showForPage( Title $title, \MediaWiki\Output\OutputPage $out ) {
		$services = MediaWikiServices::getInstance();
		$fetcher = $services->getService( 'InlineComments:AnnotationFetcher' );
		$rev = $title->getLatestRevID();
		$annotations = $rev ? $fetcher->getAnnotations( $rev ) : null;

		$out->addHTML(
			Html::rawElement( 'p', [], $this->msg( 'inlinecomments-special-desc' )->text() )
		);

		$unclosed = [];
		if ( $annotations && !$annotations->isEmpty() ) {
			$unclosed = $annotations->getData()->getValue();
		}

		$closed = $this->getClosedForPage( $title, $unclosed );

		$this->renderPanel( $out, $title, $unclosed, $closed );
	}

	private function showAll( \MediaWiki\Output\OutputPage $out ) {
		$services = MediaWikiServices::getInstance();
		$db = $services->getDBLoadBalancerFactory()->getPrimaryDatabase();
		$roleId = $services->getNameTableStoreFactory()->getSlotRoles()->getId( 'inlinecomments' );
		if ( $roleId === null ) {
			$out->addHTML(
				Html::rawElement( 'p', [], $this->msg( 'inlinecomments-special-no-comments' )->text() )
			);
			$this->renderClosedDetails( $out, [], [] );
			return;
		}

		// Find pages whose latest revision has an inlinecomments slot
		$pageIds = [];
		// Query revisions with slot, then filter to latest per page
		$query = $db->newSelectQueryBuilder()
			->select( [ 'page_id', 'page_latest', 'slot_revision_id' ] )
			->from( 'page' )
			->join( 'revision', null, 'rev_id = page_latest' )
			->join( 'slots', null, 'slot_revision_id = rev_id' )
			->where( [ 'slot_role_id' => $roleId ] )
			->caller( __METHOD__ )
			->fetchResultSet();
		foreach ( $query as $row ) {
			$pageIds[] = (int)$row->page_id;
		}
		$pageIds = array_unique( $pageIds );

		$out->addHTML(
			Html::rawElement( 'p', [], $this->msg( 'inlinecomments-special-desc' )->text() )
		);

		if ( !$pageIds ) {
			$out->addHTML(
				Html::rawElement( 'p', [ 'class' => 'mw-inlinecomments-empty' ],
					$this->msg( 'inlinecomments-special-no-comments' )->text() )
			);
			$this->renderClosedDetails( $out, [], [] );
			return;
		}

		$fetcher = $services->getService( 'InlineComments:AnnotationFetcher' );
		$wikiPageFactory = $services->getWikiPageFactory();

		$unclosedAll = [];
		$closedAll = [];

		foreach ( $pageIds as $pid ) {
			$title = Title::newFromID( $pid );
			if ( !$title || !$title->exists() ) {
				continue;
			}
			$rev = $title->getLatestRevID();
			$annotations = $rev ? $fetcher->getAnnotations( $rev ) : null;
			$unclosed = [];
			if ( $annotations && !$annotations->isEmpty() ) {
				$unclosed = $annotations->getData()->getValue();
			}
			if ( !$unclosed ) {
				continue;
			}
			foreach ( $unclosed as $ann ) {
				$ann['_page'] = $title->getPrefixedText();
				$ann['_title'] = $title;
				$unclosedAll[] = $ann;
			}
			$closed = $this->getClosedForPage( $title, $unclosed );
			foreach ( $closed as $ann ) {
				$ann['_page'] = $title->getPrefixedText();
				$ann['_title'] = $title;
				$closedAll[] = $ann;
			}
		}

		$this->renderPanelAll( $out, $unclosedAll, $closedAll );
	}

	private function getClosedForPage( Title $title, array $current ) : array {
		$services = MediaWikiServices::getInstance();
		$fetcher = $services->getService( 'InlineComments:AnnotationFetcher' );
		$currentIds = [];
		foreach ( $current as $c ) {
			if ( isset( $c['id'] ) ) {
				$currentIds[ $c['id'] ] = true;
			}
		}
		$closed = [];
		// Walk back through recent revisions to find annotations that disappeared
		$revisionLookup = $services->getRevisionLookup();
		$revId = $title->getLatestRevID();
		$seen = [];
		for ( $depth = 0; $depth < 10 && $revId; $depth++ ) {
			$rev = $revisionLookup->getRevisionById( $revId );
			if ( !$rev ) {
				break;
			}
			$ann = $fetcher->getAnnotations( $revId );
			if ( $ann && !$ann->isEmpty() ) {
				foreach ( $ann->getData()->getValue() as $item ) {
					if ( isset( $item['id'] ) && !isset( $currentIds[ $item['id'] ] ) &&
						!isset( $seen[ $item['id'] ] )
					) {
						$seen[ $item['id'] ] = true;
						$closed[] = $item;
					}
				}
			}
			$revId = $rev->getParentId();
		}
		return $closed;
	}

	private function getAuthorName( array $comment ) : string {
		if ( isset( $comment['actorId'] ) ) {
			$user = \MediaWiki\MediaWikiServices::getInstance()
				->getUserFactory()
				->newFromActorId( $comment['actorId'] );
			if ( $user && $user->getName() ) {
				return $user->getName();
			}
		}
		return $comment['author'] ?? '';
	}

	private function renderPanel( \MediaWiki\Output\OutputPage $out, Title $title, array $unclosed, array $closed ) {
		$out->addHTML(
			Html::rawElement( 'h2', [], $this->msg( 'inlinecomments-special-unclosed-heading' )->text() )
		);
		if ( !$unclosed ) {
			$out->addHTML(
				Html::rawElement( 'p', [ 'class' => 'mw-inlinecomments-empty' ],
					$this->msg( 'inlinecomments-special-no-comments' )->text() )
			);
		} else {
			$html = '<div class="mw-inlinecomments-list">';
			$html .= '<table class="wikitable mw-inlinecomments-table"><thead><tr>';
			$html .= Html::element( 'th', [], $this->msg( 'inlinecomments-special-column-highlight' )->text() );
			$html .= Html::element( 'th', [], $this->msg( 'inlinecomments-special-column-comments' )->text() );
			$html .= Html::element( 'th', [], $this->msg( 'inlinecomments-special-column-link' )->text() );
			$html .= '</tr></thead><tbody>';
			foreach ( $unclosed as $ann ) {
				$highlight = htmlspecialchars( $ann['body'] ?? '' );
				$comments = $ann['comments'] ?? [];
				$commentsHtml = '';
				foreach ( $comments as $c ) {
					$author = $this->getAuthorName( $c );
					$text = htmlspecialchars( $c['comment'] ?? '' );
					$commentsHtml .= '<div class="mw-inlinecomment-comment"><div>' .
						'<p>' . $text . '</p>' .
						'<div class="mw-inlinecomment-author">— ' . htmlspecialchars( $author ) . '</div>' .
						'</div></div>';
				}
				$link = $title->getLocalURL() . '#annotation-' . htmlspecialchars( $ann['id'] );
				$html .= '<tr><td>' . $highlight . '</td><td>' . $commentsHtml . '</td>' .
					'<td>' . Html::element( 'a', [ 'href' => $link ], $this->msg( 'inlinecomments-special-column-link' )->text() ) . '</td></tr>';
			}
			$html .= '</tbody></table></div>';
			$out->addHTML( $html );
		}
		$this->renderClosedDetails( $out, $closed, [ $title->getPrefixedText() ] );
	}

	private function renderPanelAll( \MediaWiki\Output\OutputPage $out, array $unclosedAll, array $closedAll ) {
		$out->addHTML(
			Html::rawElement( 'h2', [], $this->msg( 'inlinecomments-special-unclosed-heading' )->text() )
		);
		if ( !$unclosedAll ) {
			$out->addHTML(
				Html::rawElement( 'p', [ 'class' => 'mw-inlinecomments-empty' ],
					$this->msg( 'inlinecomments-special-no-comments' )->text() )
			);
		} else {
			$html = '<div class="mw-inlinecomments-list">';
			$html .= '<table class="wikitable mw-inlinecomments-table"><thead><tr>';
			$html .= Html::element( 'th', [], $this->msg( 'inlinecomments-special-column-page' )->text() );
			$html .= Html::element( 'th', [], $this->msg( 'inlinecomments-special-column-highlight' )->text() );
			$html .= Html::element( 'th', [], $this->msg( 'inlinecomments-special-column-comments' )->text() );
			$html .= Html::element( 'th', [], $this->msg( 'inlinecomments-special-column-link' )->text() );
			$html .= '</tr></thead><tbody>';
			foreach ( $unclosedAll as $ann ) {
				$title = $ann['_title'];
				$pageLink = Linker::link( $title, $title->getPrefixedText() );
				$highlight = htmlspecialchars( $ann['body'] ?? '' );
				$commentsHtml = '';
				foreach ( ( $ann['comments'] ?? [] ) as $c ) {
					$author = $this->getAuthorName( $c );
					$text = htmlspecialchars( $c['comment'] ?? '' );
					$commentsHtml .= '<div class="mw-inlinecomment-comment"><p>' . $text . '</p>' .
						'<div class="mw-inlinecomment-author">— ' . htmlspecialchars( $author ) . '</div></div>';
				}
				$link = $title->getLocalURL() . '#annotation-' . htmlspecialchars( $ann['id'] );
				$html .= '<tr><td>' . $pageLink . '</td><td>' . $highlight . '</td><td>' . $commentsHtml . '</td>' .
					'<td>' . Html::element( 'a', [ 'href' => $link ], $this->msg( 'inlinecomments-special-column-link' )->text() ) . '</td></tr>';
			}
			$html .= '</tbody></table></div>';
			$out->addHTML( $html );
		}
		$this->renderClosedDetails( $out, $closedAll, [] );
	}

	private function renderClosedDetails( \MediaWiki\Output\OutputPage $out, array $closed, array $unused ) {
		$out->addHTML( '<details class="mw-inlinecomments-closed"><summary>' .
			Html::element( 'span', [], $this->msg( 'inlinecomments-special-closed-heading' )->text() ) .
			'</summary>' );
		if ( !$closed ) {
			$out->addHTML(
				Html::rawElement( 'p', [], $this->msg( 'inlinecomments-special-no-comments' )->text() )
			);
		} else {
			$html = '<table class="wikitable mw-inlinecomments-table"><thead><tr>';
			$html .= Html::element( 'th', [], $this->msg( 'inlinecomments-special-column-page' )->text() );
			$html .= Html::element( 'th', [], $this->msg( 'inlinecomments-special-column-highlight' )->text() );
			$html .= Html::element( 'th', [], $this->msg( 'inlinecomments-special-column-comments' )->text() );
			$html .= '</tr></thead><tbody>';
			foreach ( $closed as $ann ) {
				$pageText = $ann['_page'] ?? '';
				$title = $ann['_title'] ?? null;
				$pageTextHtml = $title ? Linker::link( $title, $title->getPrefixedText() ) : htmlspecialchars( $pageText );
				$highlight = htmlspecialchars( $ann['body'] ?? '' );
				$commentsHtml = '';
				foreach ( ( $ann['comments'] ?? [] ) as $c ) {
					$author = $this->getAuthorName( $c );
					$text = htmlspecialchars( $c['comment'] ?? '' );
					$commentsHtml .= '<div class="mw-inlinecomment-comment"><p>' . $text . '</p>' .
						'<div class="mw-inlinecomment-author">— ' . htmlspecialchars( $author ) . '</div></div>';
				}
				$html .= '<tr><td>' . $pageTextHtml . '</td><td>' . $highlight . '</td><td>' . $commentsHtml . '</td></tr>';
			}
			$html .= '</tbody></table>';
			$out->addHTML( $html );
		}
		$out->addHTML( '</details>' );
	}
}
